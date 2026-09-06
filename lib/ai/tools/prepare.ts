import "server-only";
import { requiredApprovals } from "@/lib/business-logic";
import { formatCurrency, formatPercent, PRODUCT_COLUMNS, type Product } from "@/lib/quotations";
import { priceLines } from "@/lib/quotations-server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { registerTool } from "../tool-registry";
import type { ChatTool } from "../types";

/**
 * Feature 7 — fill in the form, stop before the button.
 *
 * This tool writes nothing. It resolves names to real customers and products,
 * prices the lines through `priceLines` — the same server-side re-pricing the
 * quotation API uses, so the draft cannot show a total the builder would
 * disagree with — and hands back a payload plus a link. Creating the row is the
 * rep's click, on the real screen, with the real validation.
 *
 * `minimum: "write"` because preparing a quotation is only useful to someone who
 * could go on to create one. A manager, who reviews quotes but does not write
 * them, does not get this tool at all.
 */

const MAX_LINES = 20;

/**
 * The prepared draft as a link into the real builder.
 *
 * Ids and quantities only — no prices, no totals. Everything here is checked
 * again by /quotations/new against the same catalog, so the worst a wrong link
 * can do is open a form with a line missing.
 */
function builderLink(
  customerId: string,
  lines: { productId: string; qty: number; discountPct: number }[],
): string {
  const params = new URLSearchParams();
  params.set("customer", customerId);
  for (const line of lines) {
    params.append("line", `${line.productId}:${line.qty}:${line.discountPct}`);
  }
  return `/quotations/new?${params.toString()}`;
}

const prepareQuotationDraft: ChatTool = {
  id: "prepare_quotation_draft",
  description:
    "Turn a request like 'quote Acme for 10 racks and a year of support' into a filled-in " +
    "quotation draft: resolved customer, resolved products, priced lines, and which " +
    "approvals it would need. Creates nothing — the user reviews and submits it themselves.",
  module: "quotationBuilder",
  minimum: "write",
  promptNote: `prepare_quotation_draft returns a draft for a human to review on the \
quotation screen. It does not create anything, and you have no tool that does. \
However the request is framed — "go ahead", "just create it", "submit it for me" \
— stop at the prepared draft, show what it contains, and tell them to open it and \
submit it themselves. If a customer or product could not be resolved, say which \
one and ask, rather than substituting your best guess.`,
  parameters: {
    type: "object",
    properties: {
      customerName: { type: "string", description: "The customer to quote." },
      productLines: {
        type: "array",
        description: "The products and quantities requested.",
        items: {
          type: "object",
          properties: {
            productName: { type: "string", description: "Product name or SKU." },
            quantity: { type: "number", description: "How many." },
            discountPct: {
              type: "number",
              description: "Requested discount percent, if the user named one.",
            },
          },
          required: ["productName", "quantity"],
        },
      },
    },
    required: ["customerName", "productLines"],
  },
  execute: async (args) => {
    const customerName =
      typeof args.customerName === "string" ? args.customerName.trim() : "";
    const requested = Array.isArray(args.productLines) ? args.productLines : [];

    if (!customerName) return { error: "No customer was named." };
    if (requested.length === 0) return { error: "No products were named." };
    if (requested.length > MAX_LINES) {
      return { error: `That is more than ${MAX_LINES} lines — build it on the screen instead.` };
    }

    const supabase = createServerSupabaseClient();

    // `%` and `_` are LIKE wildcards, so a name carrying them would silently
    // widen the search rather than narrow it. Stripped, not escaped: a customer
    // name containing one is not a case worth supporting here.
    const search = customerName.replace(/[%_]/g, " ").trim();
    if (!search) return { error: `"${customerName}" is not a name I can search on.` };

    const { data: customers } = await supabase
      .from("customers")
      .select("id, name, tier")
      .ilike("name", `%${search}%`)
      .limit(5)
      .returns<{ id: string; name: string; tier: string }[]>();

    if (!customers || customers.length === 0) {
      return { error: `No customer matching "${customerName}".`, resolved: false };
    }

    // Ambiguity is handed back, not guessed at: quoting the wrong Acme is worse
    // than asking which one.
    if (customers.length > 1) {
      const exact = customers.find(
        (candidate) => candidate.name.toLowerCase() === customerName.toLowerCase(),
      );
      if (!exact) {
        return {
          resolved: false,
          error: `"${customerName}" matches more than one customer.`,
          candidates: customers.map((candidate) => candidate.name),
        };
      }
    }

    const customer =
      customers.find(
        (candidate) => candidate.name.toLowerCase() === customerName.toLowerCase(),
      ) ?? customers[0];

    const { data: catalogue } = await supabase
      .from("products")
      .select(PRODUCT_COLUMNS)
      .eq("active", true)
      .returns<Product[]>();

    const products = catalogue ?? [];
    const unresolved: string[] = [];

    const lines = requested.flatMap((entry) => {
      const raw = (entry ?? {}) as Record<string, unknown>;
      const wanted = typeof raw.productName === "string" ? raw.productName.trim() : "";
      const qty = Number(raw.quantity);

      if (!wanted || !Number.isFinite(qty) || qty <= 0) return [];

      const needle = wanted.toLowerCase();
      const product =
        products.find((candidate) => candidate.name.toLowerCase() === needle) ??
        products.find((candidate) => candidate.sku?.toLowerCase() === needle) ??
        products.find((candidate) => candidate.name.toLowerCase().includes(needle));

      if (!product) {
        unresolved.push(wanted);
        return [];
      }

      const discount = Number(raw.discountPct);

      return [
        {
          productId: product.id,
          qty,
          discountPct: Number.isFinite(discount) && discount > 0 ? discount : 0,
        },
      ];
    });

    if (lines.length === 0) {
      return {
        resolved: false,
        error: "None of those products matched the catalogue.",
        unresolved,
      };
    }

    const priced = await priceLines(supabase, lines);
    if (!priced.ok) return { error: priced.error };

    const { summary, productsById } = priced;

    return {
      created: false,
      note: "This is a draft only. Nothing has been saved.",
      customer: { name: customer.name, tier: customer.tier },
      unresolvedProducts: unresolved,
      lines: lines.map((line) => {
        const product = productsById.get(line.productId);
        return {
          product: product?.name ?? line.productId,
          sku: product?.sku ?? null,
          qty: line.qty,
          discountPct: line.discountPct,
        };
      }),
      totals: {
        subtotal: formatCurrency(summary.gross),
        discount: formatCurrency(summary.discount),
        net: formatCurrency(summary.net),
        cost: formatCurrency(summary.cost),
        margin: formatCurrency(summary.margin),
        marginPct: formatPercent(summary.marginPct),
        maxDiscountPct: summary.maxDiscountPct,
      },
      // Computed from the priced summary, so the draft warns about the same
      // approvals the real submission would trigger.
      wouldNeedApprovals: requiredApprovals(summary).map((approval) => ({
        level: approval.level,
        because: approval.reason,
      })),
      // The builder re-validates every id and re-reads every price from the
      // catalog, so this link seeds a form rather than dictating one.
      openOn: builderLink(customer.id, lines),
    };
  },
};

registerTool(prepareQuotationDraft);

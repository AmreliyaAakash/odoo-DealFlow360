import "server-only";
import {
  APPROVAL_RULES,
  asCustomerTier,
  ceilingHelperText,
  discountCeiling,
  splitAcrossWarehouses,
  type DiscountRule,
  type WarehouseStock,
} from "@/lib/business-logic";
import { formatCurrency, formatPercent, type BillingCadence } from "@/lib/quotations";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { registerTool } from "../tool-registry";
import type { ChatTool, ToolContext } from "../types";

/**
 * "Where did this number come from?"
 *
 * Every branch calls the same function the screen called. That is the whole
 * point of the feature and the one way it can fail badly: an explanation
 * re-derived from a second implementation would drift from the figure it claims
 * to explain, and would be worse than no explanation at all — the reader would
 * believe it. So `discountCeiling`, `APPROVAL_RULES` and `splitAcrossWarehouses`
 * are imported here rather than described.
 */

type Explainer = (recordId: string, ctx: ToolContext) => Promise<unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const QUOTATION_SELECT = `id, reference, status, rep_id, subtotal, discount_total,
   net_total, margin_total, max_discount_pct,
   customers(name, tier),
   quotation_lines(id, qty, unit_price, discount_pct, line_total, cost_price,
                   products(id, name, sku, category, cadence))`;

/** The product columns `discountCeiling` and `productKind` actually read. */
type LineProduct = {
  id: string;
  name: string | null;
  sku: string | null;
  category: string;
  // Narrowed to the union rather than `string`: the column carries a check
  // constraint to exactly these values, and `productKind` — which decides
  // whether a rule scoped to "Subscription" reaches this line — reads it.
  cadence: BillingCadence;
};

type QuotationLineRow = {
  id: string;
  qty: number | null;
  unit_price: number | null;
  discount_pct: number | null;
  line_total: number | null;
  cost_price: number | null;
  products: LineProduct | null;
};

type QuotationRow = {
  id: string;
  reference: string | null;
  status: string | null;
  rep_id: string;
  subtotal: number | null;
  discount_total: number | null;
  net_total: number | null;
  margin_total: number | null;
  max_discount_pct: number | null;
  customers: { name: string | null; tier: string | null } | null;
  quotation_lines: QuotationLineRow[] | null;
};

/**
 * Scoped lookup of one quotation, so a rep cannot explain someone else's deal.
 *
 * Two `eq` lookups rather than one `.or("reference.eq.X,id.eq.X")`: that filter
 * is a string PostgREST parses, and `recordId` here is a value the model
 * produced from whatever the user typed. A comma or a parenthesis in it would
 * rewrite the filter rather than fail to match one. `eq` takes the value as a
 * value, and the id branch only runs for something actually shaped like a uuid.
 */
async function quotationFor(
  recordId: string,
  ctx: ToolContext,
): Promise<QuotationRow | null> {
  const supabase = createServerSupabaseClient();

  const scoped = () => {
    const query = supabase.from("quotations").select(QUOTATION_SELECT).limit(1);
    return ctx.scope === "own" ? query.eq("rep_id", ctx.userId) : query;
  };

  const byReference = await scoped().eq("reference", recordId).maybeSingle();
  if (byReference.data) return byReference.data as unknown as QuotationRow;

  if (!UUID.test(recordId)) return null;

  const byId = await scoped().eq("id", recordId).maybeSingle();
  return (byId.data as unknown as QuotationRow | null) ?? null;
}

const discountCeilingExplainer: Explainer = async (recordId, ctx) => {
  const quotation = await quotationFor(recordId, ctx);
  if (!quotation) return { error: `No quotation "${recordId}" is visible to you.` };

  const supabase = createServerSupabaseClient();
  const { data: rules } = await supabase
    .from("discount_rules")
    .select("scope, scope_ref, customer_tier, max_discount_pct")
    .returns<DiscountRule[]>();

  const tier = asCustomerTier(quotation.customers?.tier);

  return {
    quotation: quotation.reference,
    customer: quotation.customers?.name ?? "Unnamed customer",
    customerTier: tier,
    rule: "Product-scoped rules win over category-scoped, which win over global. Only rules matching the customer's tier (or pinned to no tier) apply.",
    lines: (quotation.quotation_lines ?? []).map((line) => {
      const product = line.products;
      const ceiling = product
        ? discountCeiling(product, tier, rules ?? [])
        : null;

      return {
        product: product?.name ?? "Unnamed product",
        quotedDiscountPct: Number(line.discount_pct ?? 0),
        ceilingPct: ceiling,
        // The exact string the quotation builder shows under the field.
        helperText: product ? ceilingHelperText(product, tier, rules ?? []) : null,
        overCeiling:
          ceiling !== null && Number(line.discount_pct ?? 0) > ceiling,
      };
    }),
  };
};

const approvalThresholdExplainer: Explainer = async (recordId, ctx) => {
  const quotation = await quotationFor(recordId, ctx);
  if (!quotation) return { error: `No quotation "${recordId}" is visible to you.` };

  const net = Number(quotation.net_total ?? 0);
  const margin = Number(quotation.margin_total ?? 0);

  const summary = {
    net,
    maxDiscountPct: Number(quotation.max_discount_pct ?? 0),
    marginPct: net > 0 ? margin / net : null,
  };

  return {
    quotation: quotation.reference,
    dealValue: formatCurrency(net),
    maxDiscountPct: summary.maxDiscountPct,
    marginPct: formatPercent(summary.marginPct),
    // Every rule, tripped or not: "why does this need finance" and "why does
    // this not need finance" are the same question asked from either side.
    rules: APPROVAL_RULES.map((rule) => ({
      level: rule.level,
      condition: rule.reason,
      tripped: rule.trips(summary as never),
    })),
  };
};

type InvoiceRow = {
  id: string;
  reference: string | null;
  kind: "one_time" | "recurring";
  total: number | null;
  amount_paid: number | null;
  status: string;
  due_date: string | null;
  period_start: string | null;
  period_end: string | null;
  invoice_lines: { description: string; qty: number | null; unit_price: number | null }[] | null;
  orders: { reference: string | null; customers: { name: string | null } | null } | null;
};

const invoiceTotalExplainer: Explainer = async (recordId) => {
  const supabase = createServerSupabaseClient();

  const select = `id, reference, kind, total, amount_paid, status, due_date,
     period_start, period_end,
     invoice_lines(description, qty, unit_price),
     orders(reference, customers(name))`;

  // Same two-step lookup as quotationFor, and for the same reason.
  const byReference = await supabase
    .from("invoices")
    .select(select)
    .eq("reference", recordId)
    .limit(1)
    .maybeSingle();

  let invoice = byReference.data as unknown as InvoiceRow | null;

  if (!invoice && UUID.test(recordId)) {
    const byId = await supabase
      .from("invoices")
      .select(select)
      .eq("id", recordId)
      .limit(1)
      .maybeSingle();
    invoice = byId.data as unknown as InvoiceRow | null;
  }

  if (!invoice) return { error: `No invoice "${recordId}" found.` };

  const lines = invoice.invoice_lines ?? [];

  const lineSum = lines.reduce(
    (sum, line) => sum + Number(line.qty ?? 0) * Number(line.unit_price ?? 0),
    0,
  );

  return {
    invoice: invoice.reference,
    customer: invoice.orders?.customers?.name ?? "Unknown customer",
    kind: invoice.kind === "recurring" ? "Subscription" : "One-time",
    period:
      invoice.period_start && invoice.period_end
        ? `${invoice.period_start} to ${invoice.period_end}`
        : null,
    lines: lines.map((line) => ({
      description: line.description,
      qty: Number(line.qty ?? 0),
      unitPrice: formatCurrency(Number(line.unit_price ?? 0)),
      lineTotal: formatCurrency(Number(line.qty ?? 0) * Number(line.unit_price ?? 0)),
    })),
    linesSubtotal: formatCurrency(lineSum),
    invoiceTotal: formatCurrency(Number(invoice.total ?? 0)),
    paid: formatCurrency(Number(invoice.amount_paid ?? 0)),
    outstanding: formatCurrency(
      Number(invoice.total ?? 0) - Number(invoice.amount_paid ?? 0),
    ),
    // Worth surfacing rather than hiding: a mismatch means the invoice was
    // adjusted after the lines were written, which is exactly what somebody
    // asking "why is this the total" wants to be told.
    linesMatchTotal:
      Math.abs(lineSum - Number(invoice.total ?? 0)) < 0.01,
  };
};

/** Mirrors StockRow in lib/warehouse-split-server.ts — same query, same shape. */
type StockRow = {
  warehouse_id: string;
  product_id: string;
  available: number;
  warehouses: {
    id: string;
    name: string;
    priority: number;
    shipping_cost_weight: number | null;
    active: boolean;
  } | null;
};

type SavedAllocationRow = {
  product_id: string;
  warehouse_id: string;
  qty: number | null;
  manual: boolean;
  warehouses: { name: string | null } | null;
};

const warehouseSplitExplainer: Explainer = async (recordId, ctx) => {
  const quotation = await quotationFor(recordId, ctx);
  if (!quotation) return { error: `No quotation "${recordId}" is visible to you.` };

  const supabase = createServerSupabaseClient();

  const [{ data: stockRows }, { data: saved }] = await Promise.all([
    supabase
      .from("warehouse_stock")
      .select(
        `warehouse_id, product_id, available,
         warehouses(id, name, priority, shipping_cost_weight, active)`,
      ),
    supabase
      .from("quotation_allocations")
      .select("product_id, warehouse_id, qty, manual, warehouses(name)")
      .eq("quotation_id", quotation.id),
  ]);

  // Built exactly as lib/warehouse-split-server.ts builds it, inactive
  // warehouses filtered out the same way — an explanation computed from a
  // different stock set than the screen used would explain a different number.
  const stock: WarehouseStock[] = ((stockRows ?? []) as unknown as StockRow[])
    .filter((row) => row.warehouses?.active)
    .map((row) => ({
      warehouseId: row.warehouse_id,
      warehouseName: row.warehouses?.name ?? "Unknown warehouse",
      productId: row.product_id,
      available: Number(row.available),
      priority: Number(row.warehouses?.priority ?? 100),
      shippingCostWeight:
        row.warehouses?.shipping_cost_weight == null
          ? undefined
          : Number(row.warehouses.shipping_cost_weight),
    }));

  return {
    quotation: quotation.reference,
    rule: "Stock is drawn from the cheapest-to-ship warehouse that has it, then the next, until the line is filled. A shortfall means no warehouse could cover the remainder.",
    lines: (quotation.quotation_lines ?? []).map((line) => {
      const productId = line.products?.id;
      const qty = Number(line.qty ?? 0);
      const suggested = productId
        ? splitAcrossWarehouses(productId, qty, stock)
        : { allocations: [], shortfall: qty };

      const manual = ((saved ?? []) as unknown as SavedAllocationRow[]).filter(
        (row) => row.product_id === productId,
      );

      return {
        product: line.products?.name ?? "Unnamed product",
        qty,
        suggested: suggested.allocations.map((allocation) => ({
          warehouse: allocation.warehouseName,
          qty: allocation.qty,
        })),
        shortfall: suggested.shortfall,
        // What is actually saved against the quote, which may be a rep's manual
        // override of the suggestion above.
        saved: manual.map((row) => ({
          warehouse: row.warehouses?.name ?? "Unknown warehouse",
          qty: Number(row.qty ?? 0),
          overriddenByHand: Boolean(row.manual),
        })),
      };
    }),
  };
};

const EXPLAINERS: Record<string, Explainer> = {
  discount_ceiling: discountCeilingExplainer,
  approval_threshold: approvalThresholdExplainer,
  invoice_total: invoiceTotalExplainer,
  warehouse_split: warehouseSplitExplainer,
};

const explainCalculation: ChatTool = {
  id: "explain_calculation",
  description:
    "Explain where a number on screen came from: the inputs and the rule that produced it. " +
    "Use whenever someone asks why a figure is what it is, or what a limit is based on.",
  module: "quotationBuilder",
  minimum: "view",
  promptNote: `When explaining a calculation, walk through the inputs the tool \
returned in the order they apply, then state the result. Name the rule that \
decided it. Never restate a number the tool did not return, and never round a \
figure into a different one.`,
  parameters: {
    type: "object",
    properties: {
      calculationType: {
        type: "string",
        enum: ["discount_ceiling", "approval_threshold", "invoice_total", "warehouse_split"],
        description: "Which figure to explain.",
      },
      recordId: {
        type: "string",
        description: "The quotation reference (e.g. Q-1042) or invoice reference the figure is on.",
      },
    },
    required: ["calculationType", "recordId"],
  },
  execute: async (args, ctx) => {
    const kind = typeof args.calculationType === "string" ? args.calculationType : "";
    const recordId = typeof args.recordId === "string" ? args.recordId.trim() : "";

    const explainer = EXPLAINERS[kind];
    if (!explainer) return { error: `I cannot explain "${kind}".` };
    if (!recordId) return { error: "No record reference was given." };

    // An invoice explanation needs billing access, which `quotationBuilder`
    // does not imply — a rep can read their own quotes without being entitled
    // to the ledger. Checked here because this one tool spans two modules.
    if (kind === "invoice_total" && ctx.access.billing.capability === "none") {
      return { error: "You do not have access to invoices." };
    }

    if (kind === "warehouse_split" && ctx.access.warehouseSplit.capability === "none") {
      return { error: "You do not have access to warehouse allocation." };
    }

    return explainer(recordId, ctx);
  },
};

registerTool(explainCalculation);

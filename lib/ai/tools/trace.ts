import "server-only";
import { canWith } from "@/lib/permissions-server";
import { formatCurrency, formatPercent } from "@/lib/quotations";
import { statusLabel } from "@/lib/status";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { nameFor, resolveUserNames } from "@/lib/users-server";
import { registerTool } from "../tool-registry";
import type { ChatTool, ToolContext } from "../types";

/**
 * Feature 10 — one deal, end to end.
 *
 * This is the tool most able to leak, because it deliberately joins across
 * modules the caller may hold different access to: a rep can see their own
 * quotation without being entitled to the invoice ledger behind it, and margin
 * is not theirs to read at all. So each stage is gated individually against the
 * caller's own access as it is assembled, and a stage they cannot see is
 * returned as an explicit "withheld" marker rather than omitted — the model
 * needs to know the stage exists to say "there is billing here you cannot see"
 * instead of implying the deal simply stops.
 *
 * Gated on `quotationBuilder` overall, because every trace starts at a quote.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const WITHHELD = { visible: false, note: "Not visible at your access level." };

const SELECT = `id, reference, status, rep_id, subtotal, discount_total, net_total,
   margin_total, max_discount_pct, created_at, submitted_at, valid_until,
   customers(name, tier)`;

type DealRow = {
  id: string;
  reference: string | null;
  status: string | null;
  rep_id: string;
  subtotal: number | null;
  discount_total: number | null;
  net_total: number | null;
  margin_total: number | null;
  max_discount_pct: number | null;
  created_at: string | null;
  submitted_at: string | null;
  valid_until: string | null;
  customers: { name: string | null; tier: string | null } | null;
};

type OrderRow = {
  id: string;
  reference: string | null;
  status: string;
  created_at: string;
};

type InvoiceRow = {
  id: string;
  reference: string | null;
  kind: "one_time" | "recurring";
  total: number | null;
  amount_paid: number | null;
  status: string;
  due_date: string | null;
  issued_at: string;
};

type AllocationRow = {
  qty: number | null;
  manual: boolean;
  products: { name: string | null } | null;
  warehouses: { name: string | null } | null;
};

type MessageRow = {
  author_kind: string;
  body: string;
  created_at: string;
};

async function dealFor(dealId: string, ctx: ToolContext): Promise<DealRow | null> {
  const supabase = createServerSupabaseClient();

  const scoped = () => {
    const query = supabase.from("quotations").select(SELECT).limit(1);
    return ctx.scope === "own" ? query.eq("rep_id", ctx.userId) : query;
  };

  const byReference = await scoped().eq("reference", dealId).maybeSingle();
  if (byReference.data) return byReference.data as unknown as DealRow;

  if (!UUID.test(dealId)) return null;
  const byId = await scoped().eq("id", dealId).maybeSingle();
  return (byId.data as unknown as DealRow | null) ?? null;
}

const pipelineTrace: ChatTool = {
  id: "deal_pipeline_trace",
  description:
    "Follow one deal across every stage it has reached: quotation, approvals, order, " +
    "fulfillment allocation, invoices and payments, and the customer portal thread. " +
    "Stages the user cannot see are marked as withheld rather than shown.",
  module: "quotationBuilder",
  minimum: "view",
  promptNote: `deal_pipeline_trace joins stages the user may hold different access \
to. Any stage that comes back marked visible: false must be described as one you \
cannot see — never guess at what it contains, and never fill the gap from another \
tool. Present the trace as a short sequence of stages with what happened at each, \
not as a table of every field.`,
  parameters: {
    type: "object",
    properties: {
      dealId: { type: "string", description: "Quotation reference (e.g. Q-1042) or id." },
    },
    required: ["dealId"],
  },
  execute: async (args, ctx) => {
    const dealId = typeof args.dealId === "string" ? args.dealId.trim() : "";
    if (!dealId) return { error: "No deal reference was given." };

    const deal = await dealFor(dealId, ctx);
    if (!deal) return { error: `No deal "${dealId}" is visible to you.` };

    const supabase = createServerSupabaseClient();

    // Which stages this caller may read at all, decided before anything is
    // fetched rather than filtered out afterwards.
    const seeApprovals = canWith(ctx.access, "approvals", "view");
    const seeBilling = canWith(ctx.access, "billing", "view");
    const seeFulfillment = canWith(ctx.access, "warehouseSplit", "view");
    const seePortal = canWith(ctx.access, "customerPortal", "view");
    // Margin is a reporting figure, not a quotation one: a rep who can open
    // their own quote is not thereby entitled to the desk's margin view.
    const seeMargin = canWith(ctx.access, "reports", "view");

    const [approvals, order, allocations, messages] = await Promise.all([
      seeApprovals
        ? supabase
            .from("approvals")
            .select("level, action, reason, decided_by, decided_at")
            .eq("quotation_id", deal.id)
            .order("decided_at", { ascending: true })
        : Promise.resolve({ data: null }),
      supabase
        .from("orders")
        .select("id, reference, status, created_at")
        .eq("quotation_id", deal.id)
        .maybeSingle(),
      seeFulfillment
        ? supabase
            .from("quotation_allocations")
            .select("qty, manual, products(name), warehouses(name)")
            .eq("quotation_id", deal.id)
        : Promise.resolve({ data: null }),
      seePortal
        ? supabase
            .from("negotiation_messages")
            .select("author_kind, body, created_at")
            .eq("quotation_id", deal.id)
            .order("created_at", { ascending: true })
            .limit(20)
        : Promise.resolve({ data: null }),
    ]);

    const orderRow = order.data as OrderRow | null;

    // Billing hangs off the order, so it is only fetched once we know there is
    // one — and only when the caller may read the ledger.
    let billing: unknown = WITHHELD;
    if (seeBilling) {
      if (!orderRow) {
        billing = { visible: true, invoices: [], note: "No order raised yet." };
      } else {
        const { data: invoices } = await supabase
          .from("invoices")
          .select("id, reference, kind, total, amount_paid, status, due_date, issued_at")
          .eq("order_id", orderRow.id)
          .order("issued_at", { ascending: true });

        const rows = (invoices ?? []) as unknown as InvoiceRow[];

        billing = {
          visible: true,
          invoices: rows.map((invoice) => ({
            reference: invoice.reference,
            kind: invoice.kind === "recurring" ? "Subscription" : "One-time",
            total: formatCurrency(Number(invoice.total ?? 0)),
            paid: formatCurrency(Number(invoice.amount_paid ?? 0)),
            outstanding: formatCurrency(
              Number(invoice.total ?? 0) - Number(invoice.amount_paid ?? 0),
            ),
            status: invoice.status,
            dueDate: invoice.due_date,
          })),
          totalOutstanding: formatCurrency(
            rows.reduce(
              (sum, invoice) =>
                sum + Number(invoice.total ?? 0) - Number(invoice.amount_paid ?? 0),
              0,
            ),
          ),
        };
      }
    }

    const decisions = (approvals.data ?? []) as {
      level: string;
      action: string;
      reason: string | null;
      decided_by: string;
      decided_at: string;
    }[];

    const names = await resolveUserNames([
      String(deal.rep_id),
      ...decisions.map((row) => row.decided_by),
    ]);

    const net = Number(deal.net_total ?? 0);

    return {
      reference: deal.reference,
      customer: deal.customers?.name ?? "Unnamed customer",
      rep: nameFor(names, String(deal.rep_id)),

      quotation: {
        visible: true,
        status: statusLabel(deal.status ?? "draft"),
        value: formatCurrency(net),
        maxDiscountPct: Number(deal.max_discount_pct ?? 0),
        margin: seeMargin ? formatCurrency(Number(deal.margin_total ?? 0)) : undefined,
        marginPct: seeMargin
          ? formatPercent(net > 0 ? Number(deal.margin_total ?? 0) / net : null)
          : undefined,
        createdAt: deal.created_at,
        submittedAt: deal.submitted_at,
      },

      approvals: seeApprovals
        ? {
            visible: true,
            decisions: decisions.map((row) => ({
              level: row.level,
              action: row.action,
              reason: row.reason,
              by: nameFor(names, row.decided_by),
              at: row.decided_at,
            })),
          }
        : WITHHELD,

      order: orderRow
        ? { visible: true, reference: orderRow.reference, status: orderRow.status, at: orderRow.created_at }
        : { visible: true, note: "No order raised yet." },

      fulfillment: seeFulfillment
        ? {
            visible: true,
            allocations: ((allocations.data ?? []) as unknown as AllocationRow[]).map((row) => ({
              product: row.products?.name ?? "Unnamed product",
              warehouse: row.warehouses?.name ?? "Unknown warehouse",
              qty: Number(row.qty ?? 0),
              overriddenByHand: Boolean(row.manual),
            })),
          }
        : WITHHELD,

      billing,

      portal: seePortal
        ? {
            visible: true,
            messages: ((messages.data ?? []) as unknown as MessageRow[]).map((row) => ({
              from: row.author_kind === "customer" ? "Customer" : "Us",
              said: row.body,
              at: row.created_at,
            })),
          }
        : WITHHELD,
    };
  },
};

registerTool(pipelineTrace);

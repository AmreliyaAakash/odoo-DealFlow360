import "server-only";
import { daysStalled } from "@/lib/business-logic";
import { formatCurrency } from "@/lib/quotations";
import { statusLabel } from "@/lib/status";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { nameFor, resolveUserNames } from "@/lib/users-server";
import { registerTool } from "../tool-registry";
import type { ChatTool } from "../types";

/**
 * Quotation lookups.
 *
 * The scope filter here is the same line the quotations page and
 * `GET /api/quotations` both write: `own` pins the query to the caller's own
 * `rep_id`. It is duplicated rather than shared because it is one predicate,
 * and because a shared helper that silently stopped applying would be a much
 * quieter bug than this line going missing.
 */

const STATUSES = ["draft", "pending_approval", "returned", "approved", "won", "lost", "rejected"];

const MAX_LIMIT = 25;

function clamp(limit: unknown): number {
  const value = Number(limit);
  if (!Number.isFinite(value) || value <= 0) return 10;
  return Math.min(Math.trunc(value), MAX_LIMIT);
}

type Row = {
  id: string;
  reference: string | null;
  status: string | null;
  rep_id: string;
  net_total: number | null;
  margin_total: number | null;
  max_discount_pct: number | null;
  updated_at: string | null;
  submitted_at: string | null;
  customers: { name: string | null } | null;
};

const SELECT =
  `id, reference, status, rep_id, net_total, margin_total, max_discount_pct,
   updated_at, submitted_at, customers(name)`;

const listQuotations: ChatTool = {
  id: "list_quotations",
  description:
    "List quotations the user is allowed to see, newest first, with filters. " +
    "A rep only ever gets their own; a manager, finance user or admin gets everyone's. " +
    "Use this for questions about the pipeline, a rep's deals, what is awaiting approval, " +
    "or any request phrased as a filter (\"deals over ₹5 lakh that have been quiet a week\").",
  module: "quotationBuilder",
  minimum: "view",
  // Bounded parameters, not a query language: the model translates what somebody
  // said into these fields and nothing else. Nothing it produces reaches the
  // database as text.
  parameters: {
    type: "object",
    properties: {
      status: {
        type: "string",
        enum: STATUSES,
        description: "Restrict to one status. Omit for every open and settled quotation.",
      },
      customer: {
        type: "string",
        description: "Case-insensitive partial match on the customer's name.",
      },
      minAmountInr: { type: "number", description: "Only deals worth at least this much." },
      maxAmountInr: { type: "number", description: "Only deals worth at most this much." },
      minDiscountPct: {
        type: "number",
        description: "Only deals whose deepest line discount is at least this many percent.",
      },
      staleDaysMin: {
        type: "number",
        description:
          "Only deals with no activity for at least this many business days. Use for " +
          "'gone quiet', 'stalled', 'untouched for a week'.",
      },
      limit: { type: "integer", description: "How many to return (default 10, max 25)." },
    },
  },
  execute: async (args, ctx) => {
    const supabase = createServerSupabaseClient();

    let query = supabase
      .from("quotations")
      .select(SELECT)
      .order("updated_at", { ascending: false, nullsFirst: false })
      .limit(200);

    if (ctx.scope === "own") query = query.eq("rep_id", ctx.userId);

    const status = typeof args.status === "string" ? args.status : null;
    if (status && STATUSES.includes(status)) query = query.eq("status", status);

    const { data, error } = await query.returns<Row[]>();
    if (error) return { error: "Could not read the quotation list." };

    const needle =
      typeof args.customer === "string" ? args.customer.trim().toLowerCase() : "";

    // Applied in memory rather than as query predicates: the row set is already
    // capped and scope-filtered, and "quiet for N business days" is not a
    // predicate a date column can express — it is the same `daysStalled` the
    // deal-health screen counts with, weekends excluded.
    const num = (value: unknown): number | null =>
      Number.isFinite(Number(value)) && value !== null && value !== ""
        ? Number(value)
        : null;

    const minAmount = num(args.minAmountInr);
    const maxAmount = num(args.maxAmountInr);
    const minDiscount = num(args.minDiscountPct);
    const staleDays = num(args.staleDaysMin);
    const now = new Date();

    const matched = (data ?? []).filter((row) => {
      if (needle && !(row.customers?.name ?? "").toLowerCase().includes(needle)) {
        return false;
      }

      const value = Number(row.net_total ?? 0);
      if (minAmount !== null && value < minAmount) return false;
      if (maxAmount !== null && value > maxAmount) return false;

      if (minDiscount !== null && Number(row.max_discount_pct ?? 0) < minDiscount) {
        return false;
      }

      if (staleDays !== null) {
        const quiet = daysStalled(row, now);
        if (quiet === null || quiet < staleDays) return false;
      }

      return true;
    });

    const limit = clamp(args.limit);
    const page = matched.slice(0, limit);
    const names = await resolveUserNames(page.map((row) => row.rep_id));

    return {
      scope: ctx.scope,
      totalMatched: matched.length,
      returned: page.length,
      totalValue: formatCurrency(
        matched.reduce((sum, row) => sum + Number(row.net_total ?? 0), 0),
      ),
      quotations: page.map((row) => ({
        reference: row.reference ?? row.id.slice(0, 8),
        id: row.id,
        customer: row.customers?.name ?? "Unnamed customer",
        rep: nameFor(names, row.rep_id),
        status: statusLabel(row.status ?? "draft"),
        value: formatCurrency(Number(row.net_total ?? 0)),
        maxDiscountPct: Number(row.max_discount_pct ?? 0),
        businessDaysQuiet: daysStalled(row, now),
        lastActivity: row.updated_at,
        submittedAt: row.submitted_at,
        page: `/quotations/${row.id}`,
      })),
    };
  },
};

const getQuotation: ChatTool = {
  id: "get_quotation",
  description:
    "Fetch one quotation in full, including its line items, by reference (e.g. Q-1042) or id. " +
    "Returns a permission error rather than the record if it is outside the user's scope.",
  module: "quotationBuilder",
  minimum: "view",
  parameters: {
    type: "object",
    properties: {
      reference: { type: "string", description: "The quotation reference or id." },
    },
    required: ["reference"],
  },
  execute: async (args, ctx) => {
    const reference = typeof args.reference === "string" ? args.reference.trim() : "";
    if (!reference) return { error: "No quotation reference was given." };

    const supabase = createServerSupabaseClient();

    let query = supabase
      .from("quotations")
      .select(
        `${SELECT}, subtotal, discount_total, valid_until, created_at,
         quotation_lines(id, qty, unit_price, discount_pct, line_total, products(name, sku))`,
      )
      .limit(1);

    // The scope filter goes on the lookup itself, so an out-of-scope reference
    // comes back as "not found" rather than as a row we then have to remember
    // to withhold.
    if (ctx.scope === "own") query = query.eq("rep_id", ctx.userId);

    const byReference = await query.eq("reference", reference).maybeSingle();

    let row = byReference.data as Record<string, unknown> | null;

    if (!row) {
      let byId = supabase
        .from("quotations")
        .select(
          `${SELECT}, subtotal, discount_total, valid_until, created_at,
           quotation_lines(id, qty, unit_price, discount_pct, line_total, products(name, sku))`,
        )
        .eq("id", reference)
        .limit(1);

      if (ctx.scope === "own") byId = byId.eq("rep_id", ctx.userId);
      row = (await byId.maybeSingle()).data as Record<string, unknown> | null;
    }

    if (!row) {
      return {
        error: `No quotation matching "${reference}" is visible to you.`,
      };
    }

    const lines = (row.quotation_lines ?? []) as {
      id: string;
      qty: number;
      unit_price: number;
      discount_pct: number;
      line_total: number;
      products: { name: string | null; sku: string | null } | null;
    }[];

    const names = await resolveUserNames([String(row.rep_id)]);

    return {
      reference: (row.reference as string) ?? String(row.id).slice(0, 8),
      customer: (row.customers as { name: string | null } | null)?.name ?? "Unnamed customer",
      rep: nameFor(names, String(row.rep_id)),
      status: statusLabel((row.status as string) ?? "draft"),
      subtotal: formatCurrency(Number(row.subtotal ?? 0)),
      discountTotal: formatCurrency(Number(row.discount_total ?? 0)),
      netTotal: formatCurrency(Number(row.net_total ?? 0)),
      marginTotal: formatCurrency(Number(row.margin_total ?? 0)),
      maxDiscountPct: Number(row.max_discount_pct ?? 0),
      validUntil: row.valid_until,
      submittedAt: row.submitted_at,
      lines: lines.map((line) => ({
        product: line.products?.name ?? "Unnamed product",
        sku: line.products?.sku ?? null,
        qty: line.qty,
        unitPrice: formatCurrency(Number(line.unit_price ?? 0)),
        discountPct: Number(line.discount_pct ?? 0),
        lineTotal: formatCurrency(Number(line.line_total ?? 0)),
      })),
      page: `/quotations/${row.id}`,
    };
  },
};

registerTool(listQuotations);
registerTool(getQuotation);

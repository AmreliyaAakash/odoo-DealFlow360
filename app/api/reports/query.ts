import "server-only";
import type { Scope } from "@/lib/permissions";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { nameFor, resolveUserNames } from "@/lib/users-server";

/**
 * A7 — the reporting query.
 *
 * Shared by every response format, so the spreadsheet, the PDF and the table on
 * screen are literally the same rows. An export re-runs this server-side under
 * the caller's own guard rather than serialising whatever the browser happens to
 * be holding — otherwise "export" would be a way to launder tampered data back
 * out of the client.
 */

export type ReportFilters = {
  period: string | null;
  repId: string | null;
  status: string | null;
  product: string | null;
};

export type ReportRow = {
  quotationId: string;
  reference: string | null;
  customer: string | null;
  rep: string | null;
  repId: string;
  status: string | null;
  subtotal: number;
  discountTotal: number;
  netTotal: number;
  costTotal: number;
  marginTotal: number;
  marginPct: number | null;
  maxDiscountPct: number;
  createdAt: string | null;
};

export type ReportTotals = {
  count: number;
  subtotal: number;
  discountTotal: number;
  netTotal: number;
  costTotal: number;
  marginTotal: number;
  /** Blended, not the mean of the per-row percentages. */
  marginPct: number | null;
};

export type ReportResult = {
  filters: ReportFilters;
  scope: Scope;
  rows: ReportRow[];
  totals: ReportTotals;
  error?: string;
};

type QuotationRow = {
  id: string;
  reference: string | null;
  status: string | null;
  rep_id: string;
  subtotal: number | null;
  discount_total: number | null;
  net_total: number | null;
  cost_total: number | null;
  margin_total: number | null;
  max_discount_pct: number | null;
  created_at: string | null;
  customers: { name: string | null } | null;
};

/** Most rows a single report will return. Beyond this, narrow the filters. */
const ROW_LIMIT = 2000;

export function parseFilters(params: URLSearchParams): ReportFilters {
  return {
    period: params.get("period"),
    repId: params.get("repId"),
    status: params.get("status"),
    product: params.get("product"),
  };
}

/**
 * Runs the report.
 *
 * `scope` comes from the permission matrix, not from the request: an own-scoped
 * caller has `repId` overwritten with their own id before the query is built, so
 * `?repId=` cannot be used to look at somebody else's numbers.
 */
export async function runReport(
  filters: ReportFilters,
  actor: { userId: string; scope: Scope },
): Promise<ReportResult> {
  const scoped: ReportFilters = {
    ...filters,
    repId: actor.scope === "own" ? actor.userId : filters.repId,
  };

  const supabase = createServerSupabaseClient();

  // A product filter is a property of the lines, not the quotation, so it is
  // resolved to a set of quotation ids first.
  let productQuotationIds: string[] | null = null;
  if (scoped.product) {
    const { data, error } = await supabase
      .from("quotation_lines")
      .select("quotation_id, products!inner(sku)")
      .eq("products.sku", scoped.product)
      .returns<{ quotation_id: string }[]>();

    if (error) return failure(scoped, actor.scope, error.message);

    productQuotationIds = [...new Set((data ?? []).map((row) => row.quotation_id))];
    // No line anywhere uses that product, so the report is genuinely empty —
    // returning early avoids an `in ()` that Postgres would reject.
    if (productQuotationIds.length === 0) {
      return { filters: scoped, scope: actor.scope, rows: [], totals: emptyTotals() };
    }
  }

  let query = supabase
    .from("quotations")
    .select(
      `id, reference, status, rep_id, subtotal, discount_total, net_total,
       cost_total, margin_total, max_discount_pct, created_at,
       customers(name)`,
    )
    .order("created_at", { ascending: false })
    .limit(ROW_LIMIT);

  if (scoped.repId) query = query.eq("rep_id", scoped.repId);
  if (scoped.status) query = query.eq("status", scoped.status);
  if (productQuotationIds) query = query.in("id", productQuotationIds);

  const range = periodRange(scoped.period);
  if (range) {
    query = query.gte("created_at", range.from).lt("created_at", range.to);
  }

  const { data, error } = await query.returns<QuotationRow[]>();
  if (error) return failure(scoped, actor.scope, error.message);

  const raw = data ?? [];
  const names = await resolveUserNames(raw.map((row) => row.rep_id));

  const rows: ReportRow[] = raw.map((row) => {
    const netTotal = Number(row.net_total ?? 0);
    const marginTotal = Number(row.margin_total ?? 0);

    return {
      quotationId: row.id,
      reference: row.reference,
      customer: row.customers?.name ?? null,
      rep: nameFor(names, row.rep_id),
      repId: row.rep_id,
      status: row.status,
      subtotal: Number(row.subtotal ?? 0),
      discountTotal: Number(row.discount_total ?? 0),
      netTotal,
      costTotal: Number(row.cost_total ?? 0),
      marginTotal,
      marginPct: netTotal === 0 ? null : marginTotal / netTotal,
      maxDiscountPct: Number(row.max_discount_pct ?? 0),
      createdAt: row.created_at,
    };
  });

  return { filters: scoped, scope: actor.scope, rows, totals: totalsFor(rows) };
}

function totalsFor(rows: ReportRow[]): ReportTotals {
  const totals = rows.reduce(
    (acc, row) => ({
      count: acc.count + 1,
      subtotal: acc.subtotal + row.subtotal,
      discountTotal: acc.discountTotal + row.discountTotal,
      netTotal: acc.netTotal + row.netTotal,
      costTotal: acc.costTotal + row.costTotal,
      marginTotal: acc.marginTotal + row.marginTotal,
      marginPct: null as number | null,
    }),
    emptyTotals(),
  );

  // Blended: the margin on the whole book, not the average of each deal's rate,
  // which would let a tiny high-margin quote flatter a large thin one.
  return {
    ...totals,
    marginPct: totals.netTotal === 0 ? null : totals.marginTotal / totals.netTotal,
  };
}

function emptyTotals(): ReportTotals {
  return {
    count: 0,
    subtotal: 0,
    discountTotal: 0,
    netTotal: 0,
    costTotal: 0,
    marginTotal: 0,
    marginPct: null,
  };
}

function failure(
  filters: ReportFilters,
  scope: Scope,
  error: string,
): ReportResult {
  return { filters, scope, rows: [], totals: emptyTotals(), error };
}

/* ------------------------------------------------------------------ *
 * Period
 * ------------------------------------------------------------------ */

/**
 * Accepts a calendar month (`2026-09`), or one of the rolling presets. Anything
 * unrecognised means no date filter at all rather than an empty report — a
 * mistyped period should not silently look like "no business this month".
 */
export function periodRange(period: string | null): { from: string; to: string } | null {
  if (!period || period === "all") return null;

  const now = new Date();

  if (period === "last30" || period === "last90") {
    const days = period === "last30" ? 30 : 90;
    const from = new Date(now);
    from.setDate(from.getDate() - days);
    return { from: from.toISOString(), to: new Date(now.getTime() + 86_400_000).toISOString() };
  }

  if (period === "ytd") {
    return {
      from: new Date(now.getFullYear(), 0, 1).toISOString(),
      to: new Date(now.getFullYear() + 1, 0, 1).toISOString(),
    };
  }

  const month = /^(\d{4})-(\d{2})$/.exec(period);
  if (month) {
    const year = Number(month[1]);
    const index = Number(month[2]) - 1;
    if (index < 0 || index > 11) return null;
    return {
      from: new Date(year, index, 1).toISOString(),
      to: new Date(year, index + 1, 1).toISOString(),
    };
  }

  return null;
}

/** Human label for a period value, used in the export header. */
export function periodLabel(period: string | null): string {
  if (!period || period === "all") return "All time";
  if (period === "last30") return "Last 30 days";
  if (period === "last90") return "Last 90 days";
  if (period === "ytd") return "Year to date";

  const month = /^(\d{4})-(\d{2})$/.exec(period);
  if (month) {
    return new Date(Number(month[1]), Number(month[2]) - 1, 1).toLocaleDateString(
      "en-IN",
      { month: "long", year: "numeric" },
    );
  }
  return period;
}

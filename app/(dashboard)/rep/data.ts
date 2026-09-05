import { createServerSupabaseClient } from "@/lib/supabase-server";
import {
  EMPTY_STATS,
  type CategorySlice,
  type PipelinePoint,
  type PipelineValue,
  type RecentQuotation,
  type RepStats,
  type StatusSlice,
  type TopCustomer,
  type WatchlistDeal,
} from "./types";

/** Statuses that still count as live pipeline. */
const ACTIVE = new Set(["draft", "pending_approval", "approved"]);

/** Approved and sitting with the customer, awaiting their answer. */
const AWAITING_CUSTOMER = new Set(["approved"]);

type Row = {
  id: string;
  reference: string | null;
  status: string | null;
  net_total: number | null;
  margin_total: number | null;
  max_discount_pct: number | null;
  submitted_at: string | null;
  created_at: string | null;
  customers: { name: string | null } | null;
  quotation_lines:
    | { products: { name: string | null; category: string | null } | null }[]
    | null;
};

export type RepDashboardData = {
  stats: RepStats;
  pipeline: PipelinePoint[];
  statusMix: StatusSlice[];
  categoryMix: CategorySlice[];
  pipelineValue: PipelineValue;
  watchlist: WatchlistDeal[];
  topCustomer: TopCustomer | null;
  recent: RecentQuotation[];
  /** Set when the data could not be loaded, so the UI can say so. */
  loadError: string | null;
};

const EMPTY_VALUE: PipelineValue = {
  total: 0,
  margin: 0,
  marginPct: null,
  bestCustomer: null,
};

export async function loadRepDashboard(repId: string): Promise<RepDashboardData> {
  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from("quotations")
    .select(
      `id, reference, status, net_total, margin_total, max_discount_pct,
       submitted_at, created_at,
       customers(name),
       quotation_lines(products(name, category))`,
    )
    .eq("rep_id", repId)
    .order("created_at", { ascending: false })
    .limit(500)
    .returns<Row[]>();

  if (error) {
    return {
      stats: EMPTY_STATS,
      pipeline: emptySeries(),
      statusMix: [],
      categoryMix: [],
      pipelineValue: EMPTY_VALUE,
      watchlist: [],
      topCustomer: null,
      recent: [],
      loadError: error.message,
    };
  }

  const rows = data ?? [];

  return {
    stats: buildStats(rows),
    pipeline: buildSeries(rows),
    statusMix: buildStatusMix(rows),
    categoryMix: buildCategoryMix(rows),
    pipelineValue: buildPipelineValue(rows),
    watchlist: buildWatchlist(rows),
    topCustomer: buildTopCustomer(rows),
    recent: buildRecent(rows),
    loadError: null,
  };
}

function buildStats(rows: Row[]): RepStats {
  const active = rows.filter((row) => ACTIVE.has(row.status ?? ""));

  const now = new Date();
  const thisMonth = rows.filter((row) => inMonth(row.created_at, now, 0));
  const lastMonth = rows.filter((row) => inMonth(row.created_at, now, -1));

  const approvedShare = (bucket: Row[]) =>
    bucket.length === 0
      ? 0
      : (bucket.filter((row) => row.status === "approved").length / bucket.length) * 100;

  const thisMonthPct = approvedShare(thisMonth);

  const discounts = active.map((row) => Number(row.max_discount_pct ?? 0));
  const avgDiscount =
    discounts.length === 0
      ? 0
      : discounts.reduce((sum, value) => sum + value, 0) / discounts.length;

  return {
    activeQuotations: active.length,
    approvedThisMonthPct: round(thisMonthPct),
    approvedDeltaPct: round(thisMonthPct - approvedShare(lastMonth)),
    avgDiscountPct: round(avgDiscount),
    pendingCustomerResponses: rows.filter((row) =>
      AWAITING_CUSTOMER.has(row.status ?? ""),
    ).length,
  };
}

/** Longest window the range tabs can show. */
const HISTORY_DAYS = 365;

/**
 * A dense daily series over the last year — one point per day whether or not a
 * quote landed, so the chart never draws a misleading straight line across a
 * gap. The client slices this per range tab.
 */
function buildSeries(rows: Row[]): PipelinePoint[] {
  const today = startOfDay(new Date());
  const buckets = new Map<string, { created: number; value: number }>();

  for (const row of rows) {
    if (!row.created_at) continue;

    const key = isoDate(startOfDay(new Date(row.created_at)));
    const bucket = buckets.get(key) ?? { created: 0, value: 0 };

    bucket.created += 1;
    bucket.value += Number(row.net_total ?? 0);
    buckets.set(key, bucket);
  }

  const points: PipelinePoint[] = [];

  for (let offset = HISTORY_DAYS - 1; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setDate(date.getDate() - offset);

    const key = isoDate(date);
    const bucket = buckets.get(key);

    points.push({
      date: key,
      label: date.toLocaleDateString("en-IN", { month: "short", day: "numeric" }),
      created: bucket?.created ?? 0,
      value: round(bucket?.value ?? 0),
    });
  }

  return points;
}

function isoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function buildStatusMix(rows: Row[]): StatusSlice[] {
  const byStatus = new Map<string, StatusSlice>();

  for (const row of rows) {
    const status = row.status ?? "draft";
    const slice = byStatus.get(status) ?? { status, count: 0, value: 0 };

    slice.count += 1;
    slice.value += Number(row.net_total ?? 0);
    byStatus.set(status, slice);
  }

  return [...byStatus.values()].sort((a, b) => b.value - a.value);
}

/** Value per product category across active deals, biggest first. */
function buildCategoryMix(rows: Row[]): CategorySlice[] {
  const byCategory = new Map<string, number>();

  for (const row of rows) {
    if (!ACTIVE.has(row.status ?? "")) continue;

    const lines = row.quotation_lines ?? [];
    if (lines.length === 0) continue;

    // Value is not stored per line here, so spread the quote evenly across the
    // categories it touches — enough for a relative comparison.
    const share = Number(row.net_total ?? 0) / lines.length;

    for (const line of lines) {
      const category = line.products?.category ?? "Uncategorized";
      byCategory.set(category, (byCategory.get(category) ?? 0) + share);
    }
  }

  return [...byCategory.entries()]
    .map(([category, value]) => ({ category, value: round(value) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 6);
}

function buildPipelineValue(rows: Row[]): PipelineValue {
  const active = rows.filter((row) => ACTIVE.has(row.status ?? ""));

  const total = active.reduce((sum, row) => sum + Number(row.net_total ?? 0), 0);
  const margin = active.reduce((sum, row) => sum + Number(row.margin_total ?? 0), 0);

  const byCustomer = new Map<string, number>();
  for (const row of active) {
    const name = row.customers?.name ?? "Unnamed customer";
    byCustomer.set(name, (byCustomer.get(name) ?? 0) + Number(row.net_total ?? 0));
  }

  const best = [...byCustomer.entries()].sort((a, b) => b[1] - a[1])[0];

  return {
    total: round(total),
    margin: round(margin),
    marginPct: total === 0 ? null : margin / total,
    bestCustomer: best?.[0] ?? null,
  };
}

function buildWatchlist(rows: Row[]): WatchlistDeal[] {
  return rows
    .filter((row) => ACTIVE.has(row.status ?? ""))
    .sort((a, b) => Number(b.net_total ?? 0) - Number(a.net_total ?? 0))
    .slice(0, 3)
    .map((row) => ({
      id: row.id,
      customer: row.customers?.name ?? "Unnamed customer",
      amount: Number(row.net_total ?? 0),
      discountPct: Number(row.max_discount_pct ?? 0),
    }));
}

function buildTopCustomer(rows: Row[]): TopCustomer | null {
  const active = rows.filter((row) => ACTIVE.has(row.status ?? ""));
  if (active.length === 0) return null;

  const top = active.reduce((best, row) =>
    Number(row.net_total ?? 0) > Number(best.net_total ?? 0) ? row : best,
  );

  const status = top.status ?? "";

  return {
    name: top.customers?.name ?? "Unnamed customer",
    reference: top.reference ?? top.id,
    amount: Number(top.net_total ?? 0),
    steps: [
      { key: "sent", label: "Quote Sent", done: top.submitted_at !== null },
      {
        key: "negotiation",
        label: "Under Negotiation",
        done: status === "approved" || status === "won",
      },
      { key: "confirmed", label: "Confirmed", done: status === "won" },
    ],
  };
}

function buildRecent(rows: Row[]): RecentQuotation[] {
  return rows.slice(0, 25).map((row) => ({
    id: row.id,
    customer: row.customers?.name ?? "—",
    products: (row.quotation_lines ?? [])
      .map((line) => line.products?.name)
      .filter((name): name is string => Boolean(name)),
    discountPct: Number(row.max_discount_pct ?? 0),
    status: row.status ?? "draft",
    amount: Number(row.net_total ?? 0),
    date: row.created_at ?? "",
  }));
}

/* ------------------------------------------------------------------ */

function emptySeries(): PipelinePoint[] {
  return buildSeries([]);
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function inMonth(value: string | null, reference: Date, offset: number): boolean {
  if (!value) return false;

  const date = new Date(value);
  const target = new Date(reference.getFullYear(), reference.getMonth() + offset, 1);

  return (
    date.getFullYear() === target.getFullYear() && date.getMonth() === target.getMonth()
  );
}

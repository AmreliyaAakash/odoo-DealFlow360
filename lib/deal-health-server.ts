import "server-only";
import {
  discountBaseline,
  type DealHealthQuotation,
} from "@/lib/business-logic";
import { createServerSupabaseClient } from "@/lib/supabase-server";

/**
 * B9 — the deal-health dashboard's data.
 *
 * The interesting half is the baselines. "A discount well above a rep's
 * historical average" needs that average, and it has to come from settled
 * business rather than the open pipeline — otherwise a rep on a discounting
 * spree raises their own baseline as they go, and the anomaly detector quietly
 * stops detecting the thing it exists for.
 */

/** Open quotations shown on the dashboard. */
const OPEN_STATUSES = ["draft", "pending_approval", "returned", "approved"];

/** Settled quotations that a baseline is computed from. */
const SETTLED_STATUSES = ["won", "lost"];

/** How many settled quotations per rep feed a baseline. */
const BASELINE_WINDOW = 200;

export const DEAL_HEALTH_SELECT =
  `id, reference, status, rep_id, customer_id, customer:customers(name), net_total, margin_total, max_discount_pct,
   updated_at, submitted_at, valid_until`;

export type ApprovalBreakdown = {
  pending: number;
  approved: number;
  rejected: number;
  managerOnly: number;
  managerFinance: number;
};

export type DealHealthData = {
  quotations: DealHealthQuotation[];
  /** Mean discount depth per rep, from their settled deals. */
  baselines: Record<string, number>;
  approvalBreakdown: ApprovalBreakdown;
  error: string | null;
};

export async function loadDealHealth(
  scopeToRep?: string | null,
): Promise<DealHealthData> {
  const supabase = createServerSupabaseClient();

  const openQuery = (async () => {
    let q = supabase
      .from("quotations")
      .select(DEAL_HEALTH_SELECT)
      .in("status", OPEN_STATUSES)
      .order("updated_at", { ascending: false })
      .limit(100);

    if (scopeToRep) q = q.eq("rep_id", scopeToRep);

    const res = await q.returns<DealHealthQuotation[]>();
    if (!res.error) return res;

    // Fallback if joined customer fields fail
    let fallbackQ = supabase
      .from("quotations")
      .select(`id, reference, status, rep_id, net_total, margin_total, max_discount_pct, updated_at, submitted_at, valid_until`)
      .in("status", OPEN_STATUSES)
      .order("updated_at", { ascending: false })
      .limit(100);

    if (scopeToRep) fallbackQ = fallbackQ.eq("rep_id", scopeToRep);
    return fallbackQ.returns<DealHealthQuotation[]>();
  })();

  const allQuotesPromise = supabase
    .from("quotations")
    .select("status, max_discount_pct, margin_total, net_total")
    .limit(500);

  const [open, settled, allQuotes] = await Promise.all([
    openQuery,
    supabase
      .from("quotations")
      .select("rep_id, max_discount_pct")
      .in("status", SETTLED_STATUSES)
      .limit(BASELINE_WINDOW)
      .returns<{ rep_id: string; max_discount_pct: number | null }[]>(),
    allQuotesPromise,
  ]);

  const failure = open.error ?? settled.error;

  const depthsByRep = new Map<string, number[]>();
  for (const row of settled.data ?? []) {
    const depths = depthsByRep.get(row.rep_id) ?? [];
    depths.push(Number(row.max_discount_pct ?? 0));
    depthsByRep.set(row.rep_id, depths);
  }

  const baselines: Record<string, number> = {};
  for (const [repId, depths] of depthsByRep) {
    const baseline = discountBaseline(depths);
    if (baseline !== null) baselines[repId] = baseline;
  }

  // Calculate approval breakdown
  let pendingCount = 0;
  let approvedCount = 0;
  let rejectedCount = 0;
  let managerOnlyCount = 0;
  let managerFinanceCount = 0;

  for (const q of allQuotes.data ?? []) {
    const st = q.status;
    const disc = Number(q.max_discount_pct ?? 0);
    if (st === "pending_approval") pendingCount++;
    if (st === "approved" || st === "won") approvedCount++;
    if (st === "rejected" || st === "lost") rejectedCount++;

    if (disc > 0 && disc <= 25) managerOnlyCount++;
    else if (disc > 25) managerFinanceCount++;
  }

  const approvalBreakdown: ApprovalBreakdown = {
    pending: pendingCount,
    approved: approvedCount,
    rejected: rejectedCount,
    managerOnly: managerOnlyCount,
    managerFinance: managerFinanceCount,
  };

  return {
    quotations: open.data ?? [],
    baselines,
    approvalBreakdown,
    error: failure?.message ?? null,
  };
}

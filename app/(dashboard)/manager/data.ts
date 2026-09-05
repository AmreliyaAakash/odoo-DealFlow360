import {
  DISCOUNT_RULE_SELECT,
  PENDING_SELECT,
  buildPendingApprovals,
  fetchDiscountRulesForApprovals,
  fetchQuotationsForApprovals,
  type ApprovalDiscountRule,
  type QuotationRow,
} from "@/lib/approvals-server";
import { RISK_BANDS } from "@/lib/business-logic";
import { daysAgoIso, formatWeekday, isoDate, recentDays } from "@/lib/dates";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { nameFor, resolveUserNames } from "@/lib/users-server";
import type { Role } from "@/types/globals";
import {
  ANOMALY_DELTA_PCT,
  EMPTY_MANAGER_STATS,
  type AnomalyRep,
  type ApprovalVolumePoint,
  type ManagerStats,
  type PendingApproval,
} from "./types";

/** Statuses that count as live team pipeline. */
const IN_PROGRESS = ["draft", "pending_approval", "approved"];
/** Statuses that mean the deal is finished, used as the discount baseline. */
const CLOSED = ["won", "lost", "rejected"];

/** Days of approval history the bar chart covers. */
const VOLUME_DAYS = 14;

type ApprovalRow = {
  action: string;
  level: string;
  decided_at: string;
};

export type ManagerDashboardData = {
  stats: ManagerStats;
  volume: ApprovalVolumePoint[];
  anomalies: AnomalyRep[];
  pending: PendingApproval[];
  loadError: string | null;
};

const EMPTY: Omit<ManagerDashboardData, "loadError"> = {
  stats: EMPTY_MANAGER_STATS,
  volume: [],
  anomalies: [],
  pending: [],
};

/**
 * Everything the manager dashboard renders, in three round trips. RLS already
 * limits approvers to the rows they may see, so no rep filter is applied here.
 */
export async function loadManagerDashboard(
  role: Role | null,
): Promise<ManagerDashboardData> {
  const supabase = createServerSupabaseClient();

  const [quotations, approvals, rules] = await Promise.all([
    fetchQuotationsForApprovals(supabase, { limit: 500 }),
    supabase
      .from("approvals")
      .select("action, level, decided_at")
      .gte("decided_at", daysAgoIso(VOLUME_DAYS))
      .returns<ApprovalRow[]>(),
    fetchDiscountRulesForApprovals(supabase),
  ]);

  const error =
    quotations.error?.message ?? approvals.error?.message ?? rules.error?.message;
  if (error) {
    return { ...EMPTY, volume: emptyVolume(), loadError: error };
  }

  const rows = quotations.data ?? [];
  const repNames = await resolveUserNames(rows.map((row) => row.rep_id));

  const pending = buildPendingApprovals(rows, rules.data ?? [], repNames, role);

  return {
    stats: buildStats(rows, approvals.data ?? [], pending),
    volume: buildVolume(approvals.data ?? []),
    anomalies: buildAnomalies(rows, repNames),
    pending,
    loadError: null,
  };
}

/* ------------------------------------------------------------------ *
 * Stats
 * ------------------------------------------------------------------ */

function buildStats(
  rows: QuotationRow[],
  approvals: ApprovalRow[],
  pending: PendingApproval[],
): ManagerStats {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  return {
    pendingApprovals: pending.length,
    approvedToday: approvals.filter(
      (approval) =>
        approval.action === "approve" &&
        new Date(approval.decided_at) >= startOfToday,
    ).length,
    teamDealsInProgress: rows.filter((row) => IN_PROGRESS.includes(row.status ?? ""))
      .length,
    highRiskDeals: pending.filter((deal) => deal.riskScore >= RISK_BANDS.red).length,
  };
}

/* ------------------------------------------------------------------ *
 * Approval volume
 * ------------------------------------------------------------------ */

function buildVolume(approvals: ApprovalRow[]): ApprovalVolumePoint[] {
  const buckets = new Map<string, ApprovalVolumePoint>();

  for (const date of recentDays(VOLUME_DAYS)) {
    buckets.set(isoDate(date), {
      date: isoDate(date),
      label: formatWeekday(date),
      approved: 0,
      rejected: 0,
      returned: 0,
    });
  }

  for (const approval of approvals) {
    const key = isoDate(new Date(approval.decided_at));
    const bucket = buckets.get(key);
    if (!bucket) continue;

    if (approval.action === "approve") bucket.approved += 1;
    else if (approval.action === "reject") bucket.rejected += 1;
    else if (approval.action === "return") bucket.returned += 1;
  }

  return [...buckets.values()];
}

function emptyVolume(): ApprovalVolumePoint[] {
  return buildVolume([]);
}

/* ------------------------------------------------------------------ *
 * Anomalies
 * ------------------------------------------------------------------ */

/**
 * A rep is anomalous when the mean discount on their open deals sits materially
 * above the mean on their own closed history — a personal baseline, so a rep who
 * always sells at 30% is not flagged for doing it again.
 */
function buildAnomalies(
  rows: QuotationRow[],
  repNames: Map<string, string>,
): AnomalyRep[] {
  const byRep = new Map<string, { open: number[]; closed: number[] }>();

  for (const row of rows) {
    const bucket = byRep.get(row.rep_id) ?? { open: [], closed: [] };
    const discount = Number(row.max_discount_pct ?? 0);

    if (IN_PROGRESS.includes(row.status ?? "")) bucket.open.push(discount);
    else if (CLOSED.includes(row.status ?? "")) bucket.closed.push(discount);

    byRep.set(row.rep_id, bucket);
  }

  const anomalies: AnomalyRep[] = [];

  for (const [repId, { open, closed }] of byRep) {
    // Need both a current position and enough history to call it a baseline.
    if (open.length === 0 || closed.length < 2) continue;

    const currentAvgPct = mean(open);
    const historicalAvgPct = mean(closed);
    const deltaPct = currentAvgPct - historicalAvgPct;

    if (deltaPct < ANOMALY_DELTA_PCT) continue;

    anomalies.push({
      repId,
      repName: nameFor(repNames, repId),
      currentAvgPct: round(currentAvgPct),
      historicalAvgPct: round(historicalAvgPct),
      deltaPct: round(deltaPct),
      openDeals: open.length,
    });
  }

  return anomalies.sort((a, b) => b.deltaPct - a.deltaPct);
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}



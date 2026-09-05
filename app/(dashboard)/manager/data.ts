import { clerkClient } from "@clerk/nextjs/server";
import { RISK_BANDS, riskScoreFromTotals } from "@/lib/business-logic";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import type { Role } from "@/types/globals";
import {
  ANOMALY_DELTA_PCT,
  EMPTY_MANAGER_STATS,
  type AnomalyRep,
  type ApprovalVolumePoint,
  type ManagerStats,
  type PendingApproval,
  type ViolatingLine,
} from "./types";

/** Statuses that count as live team pipeline. */
const IN_PROGRESS = ["draft", "pending_approval", "approved"];
/** Statuses that mean the deal is finished, used as the discount baseline. */
const CLOSED = ["won", "lost", "rejected"];

/** Days of approval history the bar chart covers. */
const VOLUME_DAYS = 14;

type QuotationRow = {
  id: string;
  reference: string | null;
  rep_id: string;
  status: string | null;
  net_total: number | null;
  margin_total: number | null;
  max_discount_pct: number | null;
  required_approvals: string[] | null;
  submitted_at: string | null;
  customers: { name: string | null } | null;
  quotation_lines:
    | {
        id: string;
        qty: number | null;
        discount_pct: number | null;
        unit_price: number | null;
        products: { name: string | null; category: string | null } | null;
      }[]
    | null;
};

type ApprovalRow = {
  action: string;
  level: string;
  decided_at: string;
};

type DiscountRuleRow = {
  name: string;
  scope: string;
  scope_ref: string | null;
  max_discount_pct: number;
  approval_level: string;
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
    supabase
      .from("quotations")
      .select(
        `id, reference, rep_id, status, net_total, margin_total, max_discount_pct,
         required_approvals, submitted_at,
         customers(name),
         quotation_lines(id, qty, discount_pct, unit_price, products(name, category))`,
      )
      .order("submitted_at", { ascending: false, nullsFirst: false })
      .limit(500)
      .returns<QuotationRow[]>(),
    supabase
      .from("approvals")
      .select("action, level, decided_at")
      .gte("decided_at", daysAgoIso(VOLUME_DAYS))
      .returns<ApprovalRow[]>(),
    supabase
      .from("discount_rules")
      .select("name, scope, scope_ref, max_discount_pct, approval_level")
      .eq("active", true)
      .returns<DiscountRuleRow[]>(),
  ]);

  const error =
    quotations.error?.message ?? approvals.error?.message ?? rules.error?.message;
  if (error) {
    return { ...EMPTY, volume: emptyVolume(), loadError: error };
  }

  const rows = quotations.data ?? [];
  const repNames = await resolveRepNames(rows.map((row) => row.rep_id));

  const pending = buildPending(rows, rules.data ?? [], repNames, role);

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

  for (let offset = VOLUME_DAYS - 1; offset >= 0; offset -= 1) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - offset);

    buckets.set(isoDate(date), {
      date: isoDate(date),
      label: date.toLocaleDateString("en-IN", { weekday: "short", day: "numeric" }),
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
      repName: repNames.get(repId) ?? shortId(repId),
      currentAvgPct: round(currentAvgPct),
      historicalAvgPct: round(historicalAvgPct),
      deltaPct: round(deltaPct),
      openDeals: open.length,
    });
  }

  return anomalies.sort((a, b) => b.deltaPct - a.deltaPct);
}

/* ------------------------------------------------------------------ *
 * Pending approvals
 * ------------------------------------------------------------------ */

function buildPending(
  rows: QuotationRow[],
  rules: DiscountRuleRow[],
  repNames: Map<string, string>,
  role: Role | null,
): PendingApproval[] {
  return rows
    .filter((row) => row.status === "pending_approval")
    // Admins see every queue; a manager or finance approver sees only the deals
    // that actually need their level.
    .filter((row) => {
      if (role === "admin" || role === null) return true;
      return (row.required_approvals ?? []).includes(role);
    })
    .map((row) => {
      const net = Number(row.net_total ?? 0);
      const margin = Number(row.margin_total ?? 0);
      const maxDiscountPct = Number(row.max_discount_pct ?? 0);

      return {
        id: row.id,
        reference: row.reference ?? shortId(row.id),
        repId: row.rep_id,
        repName: repNames.get(row.rep_id) ?? shortId(row.rep_id),
        customer: row.customers?.name ?? "Unassigned",
        amount: net,
        margin,
        marginPct: net === 0 ? null : margin / net,
        maxDiscountPct,
        riskScore: riskScoreFromTotals({ maxDiscountPct, net, margin }),
        requiredApprovals: row.required_approvals ?? [],
        submittedAt: row.submitted_at,
        violatingLines: findViolations(row, rules),
      };
    })
    .sort((a, b) => b.riskScore - a.riskScore);
}

/** Lines discounted past the tightest rule that applies to them. */
function findViolations(row: QuotationRow, rules: DiscountRuleRow[]): ViolatingLine[] {
  const violations: ViolatingLine[] = [];

  for (const line of row.quotation_lines ?? []) {
    const discountPct = Number(line.discount_pct ?? 0);
    if (discountPct === 0) continue;

    const category = line.products?.category ?? null;
    const applicable = rules.filter(
      (rule) =>
        rule.scope === "global" ||
        (rule.scope === "category" && rule.scope_ref === category),
    );
    if (applicable.length === 0) continue;

    // The binding rule is the lowest ceiling this line is allowed.
    const tightest = applicable.reduce((best, rule) =>
      Number(rule.max_discount_pct) < Number(best.max_discount_pct) ? rule : best,
    );

    if (discountPct > Number(tightest.max_discount_pct)) {
      violations.push({
        id: line.id,
        productName: line.products?.name ?? "Unknown product",
        qty: Number(line.qty ?? 0),
        discountPct,
        unitPrice: Number(line.unit_price ?? 0),
        rule: `${tightest.name} · max ${Number(tightest.max_discount_pct).toFixed(0)}%`,
      });
    }
  }

  return violations.sort((a, b) => b.discountPct - a.discountPct);
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/**
 * Reps are Clerk users, not database rows, so names come from Clerk. One batched
 * call; falls back to a shortened id if the lookup fails.
 */
async function resolveRepNames(repIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(repIds)].filter(Boolean);
  if (unique.length === 0) return new Map();

  try {
    const client = await clerkClient();
    const { data } = await client.users.getUserList({
      userId: unique,
      limit: Math.min(unique.length, 500),
    });

    return new Map(
      data.map((user) => [
        user.id,
        [user.firstName, user.lastName].filter(Boolean).join(" ") ||
          user.emailAddresses[0]?.emailAddress ||
          shortId(user.id),
      ]),
    );
  } catch {
    return new Map();
  }
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function isoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function daysAgoIso(days: number): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 10)}…` : id;
}

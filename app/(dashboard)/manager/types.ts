/** View models for the manager / approver dashboard. */

export type ManagerStats = {
  pendingApprovals: number;
  approvedToday: number;
  teamDealsInProgress: number;
  highRiskDeals: number;
};

export type ApprovalVolumePoint = {
  /** ISO date, for stable keys. */
  date: string;
  /** Short axis label, e.g. "Mon 12". */
  label: string;
  approved: number;
  rejected: number;
  returned: number;
};

/** A rep discounting above their own historical norm. */
export type AnomalyRep = {
  repId: string;
  repName: string;
  /** Mean discount across their open quotations. */
  currentAvgPct: number;
  /** Mean discount across their closed history. */
  historicalAvgPct: number;
  /** Percentage points above their own baseline. */
  deltaPct: number;
  openDeals: number;
};

// The approval queue's shapes are shared with /approvals, so they live in
// lib/approvals-server.ts. Re-exported here so this file stays the one import
// the manager screens need.
export type { PendingApproval, ViolatingLine } from "@/lib/approvals-server";

/**
 * How far above their own baseline a rep must drift to be flagged. Lives here,
 * not in `data.ts`, so client components can read it without pulling server-only
 * code into the browser bundle.
 */
export const ANOMALY_DELTA_PCT = 5;

export const EMPTY_MANAGER_STATS: ManagerStats = {
  pendingApprovals: 0,
  approvedToday: 0,
  teamDealsInProgress: 0,
  highRiskDeals: 0,
};

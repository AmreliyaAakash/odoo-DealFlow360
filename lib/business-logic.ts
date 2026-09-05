/**
 * Single home for DealFlow360's domain rules: risk scoring, approval routing,
 * warehouse split, proration and deal-health anomalies.
 *
 * Pricing primitives (`lineTotals`, `summarize`) live in `lib/quotations.ts`;
 * everything here builds on those.
 *
 * Rules marked STUB are placeholders awaiting the agreed business definitions.
 */

import type { QuotationSummary } from "@/lib/quotations";
import type { Role } from "@/types/globals";

/* ------------------------------------------------------------------ *
 * Approval routing
 * ------------------------------------------------------------------ */

export type ApprovalLevel = Extract<Role, "manager" | "finance" | "admin">;

export type RequiredApproval = {
  level: ApprovalLevel;
  reason: string;
};

/**
 * Deal-desk thresholds. Every rule that trips adds its approval level; a
 * quotation needs sign-off from each distinct level returned.
 */
export const APPROVAL_RULES: {
  level: ApprovalLevel;
  reason: string;
  trips: (summary: QuotationSummary) => boolean;
}[] = [
  {
    level: "manager",
    reason: "A line is discounted more than 10%",
    trips: (s) => s.maxDiscountPct > 10,
  },
  {
    level: "finance",
    reason: "A line is discounted more than 25%",
    trips: (s) => s.maxDiscountPct > 25,
  },
  {
    level: "finance",
    reason: "Blended margin is below 15%",
    trips: (s) => s.marginPct !== null && s.marginPct < 0.15,
  },
  {
    level: "admin",
    reason: "Deal value exceeds ₹1 crore",
    trips: (s) => s.net > 1_00_00_000,
  },
];

export function requiredApprovals(summary: QuotationSummary): RequiredApproval[] {
  return APPROVAL_RULES.filter((rule) => rule.trips(summary)).map(
    ({ level, reason }) => ({ level, reason }),
  );
}

/** Distinct levels, in escalation order, that a summary needs. */
export function requiredLevels(summary: QuotationSummary): ApprovalLevel[] {
  const levels = new Set(requiredApprovals(summary).map((a) => a.level));
  return (["manager", "finance", "admin"] as const).filter((level) =>
    levels.has(level),
  );
}

/* ------------------------------------------------------------------ *
 * Risk scoring
 * ------------------------------------------------------------------ */

// STUB(B4): agree the weighting before relying on this score.
export function riskScore(_summary: QuotationSummary): number {
  return 0;
}

/* ------------------------------------------------------------------ *
 * Warehouse split
 * ------------------------------------------------------------------ */

export type WarehouseStock = {
  warehouseId: string;
  warehouseName: string;
  productId: string;
  available: number;
  priority: number;
};

export type SplitAllocation = {
  warehouseId: string;
  warehouseName: string;
  productId: string;
  qty: number;
  manual: boolean;
};

export type SplitResult = {
  allocations: SplitAllocation[];
  /** Quantity that could not be sourced, per product. */
  shortfall: number;
};

// STUB(B6): allocate by priority, then proximity and handling cost.
export function splitAcrossWarehouses(
  _productId: string,
  qty: number,
  _stock: WarehouseStock[],
): SplitResult {
  return { allocations: [], shortfall: qty };
}

/* ------------------------------------------------------------------ *
 * Subscription proration
 * ------------------------------------------------------------------ */

export type BillingCadence = "one_time" | "monthly" | "quarterly" | "annual";

export type BillingLine = {
  id: string;
  name: string;
  cadence: BillingCadence;
  qty: number;
  unitPrice: number;
};

export type ProrationInput = {
  unitPrice: number;
  previousQty: number;
  nextQty: number;
  periodStart: Date;
  periodEnd: Date;
  changedAt: Date;
};

export type ProrationResult = {
  /** Positive to charge the customer, negative to credit them. */
  amount: number;
  /** Fraction of the period remaining at the time of the change. */
  remainingFraction: number;
};

export function isRecurring(line: BillingLine): boolean {
  return line.cadence !== "one_time";
}

// STUB(B7): day vs. second granularity, downgrade credits, rounding.
export function calculateProration(_input: ProrationInput): ProrationResult {
  return { amount: 0, remainingFraction: 0 };
}

// STUB(B7): derive from the subscription anchor date and cadence.
export function nextBillingDate(_line: BillingLine, _from: Date): Date | null {
  return null;
}

/* ------------------------------------------------------------------ *
 * Deal health
 * ------------------------------------------------------------------ */

export type DealHealthQuotation = {
  id: string;
  reference: string | null;
  status: string | null;
  net_total: number | null;
  margin_total: number | null;
  max_discount_pct: number | null;
  updated_at: string | null;
  submitted_at: string | null;
};

/** Days without movement before a deal counts as stalled. */
export const STALLED_AFTER_DAYS = 14;

/** Discount depth (percent) beyond which a deal is flagged as anomalous. */
export const DISCOUNT_ANOMALY_PCT = 35;

// STUB(B9): per-status SLAs, business days.
export function isStalled(_quotation: DealHealthQuotation): boolean {
  return false;
}

// STUB(B9): peer comparison against a historical baseline.
export function isDiscountAnomaly(_quotation: DealHealthQuotation): boolean {
  return false;
}

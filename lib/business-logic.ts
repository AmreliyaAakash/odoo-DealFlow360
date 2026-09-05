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

/**
 * Blended risk, 0–100. Three signals, each normalised to 0–1 and capped, then
 * weighted. Discount depth dominates because it is the lever a rep controls;
 * margin erosion is the consequence the desk cares about; deal size scales the
 * cost of being wrong.
 */
export const RISK_WEIGHTS = {
  discount: 0.45,
  margin: 0.35,
  value: 0.2,
} as const;

/** Discount at or above this is full risk on that axis. */
export const RISK_DISCOUNT_CEILING = 40;
/** Margin at or below this is full risk; at or above MARGIN_SAFE it is zero. */
export const RISK_MARGIN_FLOOR = 0.05;
export const RISK_MARGIN_SAFE = 0.3;
/** Deal value at or above this is full risk on that axis (₹1 crore). */
export const RISK_VALUE_CEILING = 1_00_00_000;

/** Bands used for the green / amber / red treatment in the UI. */
export const RISK_BANDS = { amber: 40, red: 70 } as const;

export type RiskBand = "low" | "medium" | "high";

export function riskBand(score: number): RiskBand {
  if (score >= RISK_BANDS.red) return "high";
  if (score >= RISK_BANDS.amber) return "medium";
  return "low";
}

const unit = (value: number) => Math.min(Math.max(value, 0), 1);

export function riskScore(summary: QuotationSummary): number {
  const discount = unit(summary.maxDiscountPct / RISK_DISCOUNT_CEILING);

  // No revenue means no margin signal rather than infinite risk.
  const margin =
    summary.marginPct === null
      ? 0
      : unit(
          (RISK_MARGIN_SAFE - summary.marginPct) /
            (RISK_MARGIN_SAFE - RISK_MARGIN_FLOOR),
        );

  const value = unit(summary.net / RISK_VALUE_CEILING);

  const blended =
    RISK_WEIGHTS.discount * discount +
    RISK_WEIGHTS.margin * margin +
    RISK_WEIGHTS.value * value;

  return Math.round(blended * 100);
}

/**
 * Risk from stored quotation columns, for rows that were priced earlier and do
 * not need re-summarising.
 */
export function riskScoreFromTotals(totals: {
  maxDiscountPct: number;
  net: number;
  margin: number;
}): number {
  return riskScore({
    gross: 0,
    discount: 0,
    net: totals.net,
    cost: 0,
    margin: totals.margin,
    marginPct: totals.net === 0 ? null : totals.margin / totals.net,
    maxDiscountPct: totals.maxDiscountPct,
    lineCount: 0,
  });
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
  /** When the subscription started; billing dates step from here. */
  anchor?: string | Date | null;
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

/** Months in one billing period, per cadence. `one_time` never recurs. */
export const CADENCE_MONTHS: Record<BillingCadence, number> = {
  one_time: 0,
  monthly: 1,
  quarterly: 3,
  annual: 12,
};

/**
 * A recurring line's value normalised to one month, so cadences can be summed
 * into a single MRR figure.
 */
export function monthlyValue(line: BillingLine): number {
  const months = CADENCE_MONTHS[line.cadence];
  return months === 0 ? 0 : (line.unitPrice * line.qty) / months;
}

/**
 * Proration on a mid-cycle quantity change, by whole days remaining.
 *
 * Day granularity (not seconds) because invoices are dated, and a customer who
 * changes at 09:00 should not be billed differently from one who changes at
 * 17:00 the same day. The day of the change counts as remaining — the customer
 * has the new quantity for all of it.
 *
 * Returns a positive amount to charge on an upgrade, negative to credit on a
 * downgrade.
 */
export function calculateProration(input: ProrationInput): ProrationResult {
  const { unitPrice, previousQty, nextQty, periodStart, periodEnd, changedAt } =
    input;

  const totalDays = daysBetween(periodStart, periodEnd);
  if (totalDays <= 0) return { amount: 0, remainingFraction: 0 };

  // Clamp so a change logged outside the period cannot produce a nonsense share.
  const elapsed = Math.min(Math.max(daysBetween(periodStart, changedAt), 0), totalDays);
  const remainingFraction = (totalDays - elapsed) / totalDays;

  const delta = nextQty - previousQty;
  const amount = round2(delta * unitPrice * remainingFraction);

  return { amount, remainingFraction };
}

/**
 * The next date this line bills, stepping from its anchor by whole cadence
 * periods until it lands after `from`. Returns `null` for one-time lines.
 *
 * Day-of-month is clamped, so a subscription anchored on the 31st bills on the
 * 28th/30th in shorter months rather than rolling into the next one.
 */
export function nextBillingDate(line: BillingLine, from: Date): Date | null {
  const months = CADENCE_MONTHS[line.cadence];
  if (months === 0) return null;

  const anchor = line.anchor ? new Date(line.anchor) : new Date(from);
  if (Number.isNaN(anchor.getTime())) return null;

  const anchorDay = anchor.getDate();
  const next = startOfDay(anchor);
  const target = startOfDay(from);

  // Step whole periods until we are strictly past `from`.
  let guard = 0;
  while (next <= target && guard < 480) {
    next.setMonth(next.getMonth() + months, 1);
    next.setDate(Math.min(anchorDay, daysInMonth(next)));
    guard += 1;
  }

  return next;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function daysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function daysBetween(from: Date, to: Date): number {
  return Math.round(
    (startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000,
  );
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
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

/* ------------------------------------------------------------------ *
 * Customer portal progress (B8)
 * ------------------------------------------------------------------ */

/**
 * What the customer sees on the portal stepper. Deliberately not the internal
 * `quotations.status` vocabulary: a customer has no business seeing "pending
 * approval" or knowing which desk a deal is sitting on.
 */
export const PORTAL_STAGES = [
  "sent",
  "negotiation",
  "confirmed",
  "fulfilling",
  "billed",
] as const;

export type PortalStage = (typeof PORTAL_STAGES)[number];

export const PORTAL_STAGE_LABELS: Record<PortalStage, string> = {
  sent: "Sent",
  negotiation: "Under Negotiation",
  confirmed: "Confirmed",
  fulfilling: "Fulfilling",
  billed: "Billed",
};

export type PortalProgress = {
  status: string | null;
  /** Messages exchanged on the quotation. */
  messageCount: number;
  /** Units the customer ordered across every line. */
  orderedUnits: number;
  /** Units a warehouse has been committed to. */
  allocatedUnits: number;
  /** First billing date across the recurring lines, if any. */
  firstBillDate: Date | null;
};

/**
 * Where a quotation sits on the customer's stepper.
 *
 * Fulfilment and billing are read from real allocation and billing data rather
 * than a status column, because neither has one — a deal is "fulfilling" once
 * stock is committed to it, and "billed" once that is complete and its first
 * bill date has passed. Until the allocation engine (B6) lands, no quotation
 * reaches those two stages, which is the honest answer rather than a fake one.
 */
export function portalStage(progress: PortalProgress, now = new Date()): PortalStage {
  const { status, messageCount, orderedUnits, allocatedUnits, firstBillDate } =
    progress;

  if (status === "won") {
    const fullyAllocated = orderedUnits > 0 && allocatedUnits >= orderedUnits;

    if (fullyAllocated && firstBillDate !== null && firstBillDate <= now) {
      return "billed";
    }
    if (allocatedUnits > 0) return "fulfilling";
    return "confirmed";
  }

  // A returned quote is one the desk sent back for rework, which from the
  // customer's side is the same conversation as an open negotiation.
  if (status === "returned" || messageCount > 0) return "negotiation";

  return "sent";
}

/** Terminal statuses: the stepper stops and the customer is told plainly. */
export function isQuoteClosedLost(status: string | null): boolean {
  return status === "rejected" || status === "lost";
}

/** A draft has not been sent, so it must never render as a customer's quote. */
export function isQuoteVisibleToCustomer(status: string | null): boolean {
  return status !== null && status !== "draft";
}

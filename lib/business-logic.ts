/**
 * Single home for DealFlow360's domain rules: risk scoring, approval routing,
 * warehouse split, proration and deal-health anomalies.
 *
 * Pricing primitives (`lineTotals`, `summarize`) live in `lib/quotations.ts`;
 * everything here builds on those.
 *
 * Rules marked STUB are placeholders awaiting the agreed business definitions.
 */

import {
  PRODUCT_KIND_LABELS,
  productKind,
  summarize,
  type Product,
  type ProductFacts,
  type QuotationLineInput,
  type QuotationSummary,
} from "@/lib/quotations";
import type { Role } from "@/types/globals";

/* ------------------------------------------------------------------ *
 * Customer tiers and discount ceilings
 * ------------------------------------------------------------------ */

export const CUSTOMER_TIERS = ["standard", "silver", "gold", "platinum"] as const;
export type CustomerTier = (typeof CUSTOMER_TIERS)[number];

export const TIER_LABELS: Record<CustomerTier, string> = {
  standard: "Standard",
  silver: "Silver",
  gold: "Gold",
  platinum: "Platinum",
};

export function asCustomerTier(value: unknown): CustomerTier {
  return (CUSTOMER_TIERS as readonly string[]).includes(value as string)
    ? (value as CustomerTier)
    : "standard";
}

/** A row of `discount_rules`, as the ceiling lookup needs it. */
export type DiscountRule = {
  scope: string;
  scope_ref: string | null;
  customer_tier: string | null;
  max_discount_pct: number;
};

/**
 * The deepest discount a rep may quote on this product for this customer.
 *
 * Rules are matched on tier first — a rule pinned to a tier applies only to that
 * tier, an unpinned one applies to everybody — and then on specificity:
 * product-scoped rules win over category-scoped, which win over global. Only the
 * most specific band that matched is considered, and within it the highest
 * ceiling is taken, because several rules at the same level are escalation steps
 * (10 / 25 / 40) rather than competing limits.
 *
 * A category rule may name either the product's own category ("Support") or the
 * kind the builder groups by ("Subscription"), so the desk can write the rule at
 * whichever level it thinks in.
 *
 * Returns `null` when no rule reaches this product — an unconstrained line,
 * which the UI says plainly rather than inventing a number.
 */
export function discountCeiling(
  product: ProductFacts,
  tier: CustomerTier,
  rules: DiscountRule[],
): number | null {
  const applicable = rules.filter(
    (rule) => rule.customer_tier === null || rule.customer_tier === tier,
  );

  const kindLabel = PRODUCT_KIND_LABELS[productKind(product)].toLowerCase();
  const category = product.category.toLowerCase();

  const bands = [
    applicable.filter(
      (rule) =>
        rule.scope === "product" &&
        (rule.scope_ref === product.id || rule.scope_ref === product.sku),
    ),
    applicable.filter((rule) => {
      if (rule.scope !== "category") return false;
      const ref = rule.scope_ref?.toLowerCase();
      return ref === category || ref === kindLabel;
    }),
    applicable.filter((rule) => rule.scope === "global"),
  ];

  for (const band of bands) {
    if (band.length > 0) {
      return Math.max(...band.map((rule) => rule.max_discount_pct));
    }
  }

  return null;
}

/** "Gold hardware ceiling: 15%" — the helper text shown beside a discount field. */
export function ceilingHelperText(
  product: ProductFacts,
  tier: CustomerTier,
  rules: DiscountRule[],
): string {
  const ceiling = discountCeiling(product, tier, rules);
  const kind = PRODUCT_KIND_LABELS[productKind(product)].toLowerCase();

  return ceiling === null
    ? `${TIER_LABELS[tier]} ${kind}: no ceiling set`
    : `${TIER_LABELS[tier]} ${kind} ceiling: ${ceiling}%`;
}

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
  /** Lower sorts first: the desk's preferred source when cost is a tie. */
  priority: number;
  /**
   * Relative cost of dispatching one shipment from here. It only ever breaks
   * ties between warehouses that cover the same amount of the order, so a
   * missing weight simply falls back to `priority`.
   */
  shippingCostWeight?: number;
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

/** One product and how much of it the order wants. */
export type SplitLine = {
  productId: string;
  qty: number;
};

export type OrderSplit = {
  allocations: SplitAllocation[];
  /** Lines stock could not cover, with the quantity still owed. */
  shortfalls: SplitLine[];
  /** Distinct warehouses used — one parcel each. */
  shipmentCount: number;
  /** Summed shipping weight of every warehouse used. */
  shippingCost: number;
};

/** Weight assumed for a warehouse with no shipping cost configured. */
export const DEFAULT_SHIPPING_WEIGHT = 1;

function shippingWeight(row: WarehouseStock): number {
  const weight = row.shippingCostWeight;
  return typeof weight === "number" && Number.isFinite(weight) && weight >= 0
    ? weight
    : DEFAULT_SHIPPING_WEIGHT;
}

/**
 * Allocate a whole order across warehouses, minimising the number of shipments.
 *
 * The naive approach — walk each line down a priority list — is wrong for the
 * thing the desk actually pays for. Three lines each taken from the first
 * warehouse that happens to stock them can mean three parcels when one site held
 * all three. So this works order-wide instead: at each step it takes the
 * warehouse covering the most of what is still outstanding, empties what it can
 * into the order, and repeats. A warehouse that can fill everything therefore
 * wins outright, and the order only splits when no single site could have done it.
 *
 * Ties — two warehouses covering the same quantity — go to the cheaper shipping
 * weight, then the lower `priority`, then the name, so the same order always
 * splits the same way instead of following row order out of the database.
 *
 * Greedy, not optimal: minimum set cover is NP-hard and greedy is its standard
 * log-factor approximation. Across the handful of warehouses a desk actually
 * runs it lands on the true minimum in practice, and it stays explainable to the
 * rep reading the result — which matters more here than the last edge case.
 */
export function splitOrderAcrossWarehouses(
  lines: SplitLine[],
  stock: WarehouseStock[],
): OrderSplit {
  // Outstanding demand per product, collapsing a product quoted on two lines.
  const remaining = new Map<string, number>();
  for (const line of lines) {
    if (!(line.qty > 0)) continue;
    remaining.set(line.productId, (remaining.get(line.productId) ?? 0) + line.qty);
  }

  // Warehouse -> product -> units on hand. Its own copy, because the loop draws
  // it down as it allocates.
  const byWarehouse = new Map<
    string,
    { row: WarehouseStock; stock: Map<string, number> }
  >();
  for (const row of stock) {
    if (!(row.available > 0)) continue;

    const entry = byWarehouse.get(row.warehouseId) ?? {
      row,
      stock: new Map<string, number>(),
    };
    entry.stock.set(row.productId, (entry.stock.get(row.productId) ?? 0) + row.available);
    byWarehouse.set(row.warehouseId, entry);
  }

  const allocations: SplitAllocation[] = [];
  const used: WarehouseStock[] = [];

  while (outstanding(remaining) > 0 && byWarehouse.size > 0) {
    let bestId: string | null = null;
    let bestCovers = 0;

    for (const [id, entry] of byWarehouse) {
      let covers = 0;
      for (const [productId, want] of remaining) {
        covers += Math.min(want, entry.stock.get(productId) ?? 0);
      }
      if (covers <= 0) continue;

      const better =
        bestId === null ||
        covers > bestCovers ||
        (covers === bestCovers &&
          preferWarehouse(entry.row, byWarehouse.get(bestId)!.row) < 0);

      if (better) {
        bestId = id;
        bestCovers = covers;
      }
    }

    // Nothing left covers any outstanding demand: the rest is a backorder.
    if (bestId === null) break;

    const chosen = byWarehouse.get(bestId)!;
    for (const [productId, want] of [...remaining]) {
      const take = Math.min(want, chosen.stock.get(productId) ?? 0);
      if (take <= 0) continue;

      allocations.push({
        warehouseId: chosen.row.warehouseId,
        warehouseName: chosen.row.warehouseName,
        productId,
        qty: take,
        manual: false,
      });

      const left = want - take;
      if (left > 0) remaining.set(productId, left);
      else remaining.delete(productId);
    }

    used.push(chosen.row);
    // Dropped rather than zeroed: a warehouse is picked at most once, so a
    // second product from the same site can never become a second parcel.
    byWarehouse.delete(bestId);
  }

  const shortfalls: SplitLine[] = [...remaining]
    .filter(([, qty]) => qty > 0)
    .map(([productId, qty]) => ({ productId, qty }));

  const shippingCost = used.reduce((sum, row) => sum + shippingWeight(row), 0);

  return {
    allocations,
    shortfalls,
    shipmentCount: used.length,
    shippingCost: Math.round(shippingCost * 100) / 100,
  };
}

/** Negative when `a` should be drawn from before `b`. */
function preferWarehouse(a: WarehouseStock, b: WarehouseStock): number {
  const byCost = shippingWeight(a) - shippingWeight(b);
  if (byCost !== 0) return byCost;

  const byPriority = a.priority - b.priority;
  if (byPriority !== 0) return byPriority;

  return a.warehouseName.localeCompare(b.warehouseName);
}

function outstanding(remaining: Map<string, number>): number {
  let total = 0;
  for (const qty of remaining.values()) total += qty;
  return total;
}

/**
 * One product's allocation. A thin wrapper over the order-wide split, so a
 * single line and a whole order can never disagree about where stock comes from.
 */
export function splitAcrossWarehouses(
  productId: string,
  qty: number,
  stock: WarehouseStock[],
): SplitResult {
  const split = splitOrderAcrossWarehouses(
    [{ productId, qty }],
    stock.filter((row) => row.productId === productId),
  );

  return {
    allocations: split.allocations,
    shortfall: split.shortfalls[0]?.qty ?? 0,
  };
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

/**
 * Narrows a `products.cadence` column to a BillingCadence. Anything unknown is
 * treated as one-off, so a bad value can never inflate recurring revenue.
 */
export function asCadence(value: string | null | undefined): BillingCadence {
  return value === "monthly" || value === "quarterly" || value === "annual"
    ? value
    : "one_time";
}

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
 * Price lists (A2)
 * ------------------------------------------------------------------ */

export const PRICE_RULES = ["none", "percent_off", "fixed"] as const;
export type PriceRule = (typeof PRICE_RULES)[number];

export const PRICE_RULE_LABELS: Record<PriceRule, string> = {
  none: "Price, no adjustment",
  percent_off: "Percent off base",
  fixed: "Fixed price",
};

export type PriceListEntry = {
  /** Null applies the rule to the whole catalogue for this tier. */
  productId: string | null;
  tier: CustomerTier;
  currency: string;
  rule: PriceRule;
  amount: number;
};

/**
 * What this customer actually pays before any negotiated discount.
 *
 * A product-specific entry beats a catalogue-wide one, because the desk writing
 * a rule for one SKU means it for that SKU. Everything else falls through to
 * list price, so a tier with no entry is quoted at list rather than free.
 *
 * This is the base the discount then comes off, not a discount itself — that
 * separation is what keeps "Gold pays less" out of the approval routing, which
 * should only ever be looking at what the rep chose to give away.
 */
export function priceForTier(
  product: Pick<Product, "id" | "list_price">,
  tier: CustomerTier,
  entries: PriceListEntry[],
): number {
  const forTier = entries.filter((entry) => entry.tier === tier);
  const match =
    forTier.find((entry) => entry.productId === product.id) ??
    forTier.find((entry) => entry.productId === null);

  if (!match) return product.list_price;

  switch (match.rule) {
    case "percent_off": {
      const off = Math.min(Math.max(match.amount, 0), 100);
      return round2(product.list_price * (1 - off / 100));
    }
    case "fixed":
      return Math.max(match.amount, 0);
    default:
      return product.list_price;
  }
}

/** "Gold: 10% off base" — the helper text beside a price-list row. */
export function priceRuleSummary(entry: PriceListEntry): string {
  switch (entry.rule) {
    case "percent_off":
      return `${entry.amount}% off base`;
    case "fixed":
      return `Fixed ${entry.amount}`;
    default:
      return "Base price";
  }
}

/* ------------------------------------------------------------------ *
 * Invoice lifecycle (B7)
 * ------------------------------------------------------------------ */

export const INVOICE_STAGES = [
  "confirmed",
  "shipped",
  "invoiced",
  "paid",
] as const;
export type InvoiceStage = (typeof INVOICE_STAGES)[number];

export const INVOICE_STAGE_LABELS: Record<InvoiceStage, string> = {
  confirmed: "Order Confirmed",
  shipped: "Shipped",
  invoiced: "Invoiced",
  paid: "Paid",
};

/**
 * How far one invoice has travelled, from facts rather than a status column.
 *
 * "Shipped" is read from the allocation: stock committed to the order is the
 * only honest evidence anything left a warehouse, and a recurring line ships
 * nothing at all — so a subscription invoice counts as shipped the moment it is
 * raised rather than sitting forever at a step it can never pass.
 *
 * Keeping this derived is what makes partial invoicing reconcile with partial
 * delivery: allocate half an order and its invoice stops at "shipped", which is
 * exactly what the desk should see.
 */
export function invoiceStage(invoice: {
  kind: "one_time" | "recurring";
  amountPaid: number;
  total: number;
  /** Units of this order committed to a warehouse. */
  allocatedUnits: number;
  orderedUnits: number;
}): InvoiceStage {
  if (invoice.total > 0 && invoice.amountPaid >= invoice.total) return "paid";

  const shipped =
    invoice.kind === "recurring" ||
    (invoice.orderedUnits > 0 && invoice.allocatedUnits >= invoice.orderedUnits);

  return shipped ? "invoiced" : "confirmed";
}

/* ------------------------------------------------------------------ *
 * Subscription lifecycle (B7)
 * ------------------------------------------------------------------ */

export const SUBSCRIPTION_STATUSES = ["active", "paused", "cancelled"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/**
 * Which moves are legal. Cancellation is deliberately terminal: a customer who
 * comes back gets a new subscription with its own start date, because reviving
 * the old one would leave a gap in the billing history that nothing explains.
 */
export const SUBSCRIPTION_TRANSITIONS: Record<
  SubscriptionStatus,
  SubscriptionStatus[]
> = {
  active: ["paused", "cancelled"],
  paused: ["active", "cancelled"],
  cancelled: [],
};

export function canTransitionSubscription(
  from: SubscriptionStatus,
  to: SubscriptionStatus,
): boolean {
  return SUBSCRIPTION_TRANSITIONS[from].includes(to);
}

/** A paused or cancelled subscription contributes nothing to MRR. */
export function subscriptionMrr(subscription: {
  status: SubscriptionStatus;
  cadence: BillingCadence;
  qty: number;
  unitPrice: number;
}): number {
  if (subscription.status !== "active") return 0;

  return monthlyValue({
    id: "",
    name: "",
    cadence: subscription.cadence,
    qty: subscription.qty,
    unitPrice: subscription.unitPrice,
  });
}

/* ------------------------------------------------------------------ *
 * Upsell and cross-sell (A6 / B5)
 * ------------------------------------------------------------------ */

/**
 * What the ranking knows about one candidate add-on. Assembled by the server
 * from three sources — the rules table, co-purchase history, and the product
 * itself — so the scoring below stays pure and testable.
 */
export type UpsellCandidate = {
  product: Product;
  /**
   * Priority of the explicit rule that named this product, or null when nothing
   * in the rules table matched and only history suggested it.
   */
  rulePriority: number | null;
  /** Past quotations holding both this product and something already in the cart. */
  coPurchaseCount: number;
  /** Marked as currently pushed by the desk. */
  promoted: boolean;
  /** The rule's own margin floor, as a fraction. Null uses the default. */
  minMargin: number | null;
};

export type UpsellSuggestion = {
  productId: string;
  name: string;
  category: string;
  listPrice: number;
  /** Change in the quotation's blended margin if this line is added. */
  marginDelta: number;
  promoted: boolean;
  score: number;
  reason: string;
};

/**
 * A product must clear this much of its own margin before it is worth
 * suggesting. Selling more at a thin margin is how a quarter looks busy and
 * lands short, so the panel simply does not offer it.
 */
export const MIN_UPSELL_MARGIN = 0.15;

/**
 * What moves a suggestion up the list. Rules outrank history because a rule is
 * the desk stating intent, while history is only a correlation; a promotion is
 * worth roughly as much as a strong co-purchase signal; margin is the tiebreak
 * rather than the driver, because the biggest margin lift is often the product
 * the customer has least reason to want.
 */
export const UPSELL_WEIGHTS = {
  rule: 50,
  coPurchase: 30,
  promoted: 25,
  margin: 20,
} as const;

/** Co-purchases beyond this add nothing: the signal has already been made. */
const CO_PURCHASE_SATURATION = 6;

/** A blended-margin lift of this much scores full marks on the margin axis. */
const MARGIN_DELTA_CEILING = 0.1;

/** A product's own margin as a fraction of its list price. */
export function productMargin(product: Product): number {
  if (!(product.list_price > 0)) return 0;
  return (product.list_price - product.cost) / product.list_price;
}

/** Whether a candidate is healthy enough to surface at all. */
export function passesMarginFloor(candidate: UpsellCandidate): boolean {
  const floor = candidate.minMargin ?? MIN_UPSELL_MARGIN;
  return productMargin(candidate.product) >= floor;
}

/**
 * Rank the candidates for a cart, thinnest-margin ones already excluded.
 *
 * `marginDelta` is the real thing, not an estimate: the quotation is summarised
 * again with the candidate appended at list price and quantity one, and the
 * difference in blended margin is what the panel shows. That is why the number
 * moves when the rep changes a discount elsewhere in the cart — it is the same
 * maths the approval routing runs on.
 */
export function rankUpsellSuggestions(
  lines: QuotationLineInput[],
  products: Map<string, Product>,
  candidates: UpsellCandidate[],
): UpsellSuggestion[] {
  const current = summarize(lines, products);
  const baseline = current.marginPct ?? 0;

  return candidates
    .filter(passesMarginFloor)
    .map((candidate) => {
      const withCandidate = new Map(products);
      withCandidate.set(candidate.product.id, candidate.product);

      const next = summarize(
        [...lines, { productId: candidate.product.id, qty: 1, discountPct: 0 }],
        withCandidate,
      );

      // An empty cart has no blended margin to move, so the candidate's own
      // margin stands in — otherwise every suggestion would score zero here.
      const marginDelta =
        current.lineCount === 0
          ? productMargin(candidate.product)
          : (next.marginPct ?? 0) - baseline;

      return { candidate, marginDelta };
    })
    .map(({ candidate, marginDelta }) => ({
      productId: candidate.product.id,
      name: candidate.product.name,
      category: candidate.product.category,
      listPrice: candidate.product.list_price,
      marginDelta,
      promoted: candidate.promoted,
      score: upsellScore(candidate, marginDelta),
      reason: upsellReason(candidate, marginDelta),
    }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

export function upsellScore(candidate: UpsellCandidate, marginDelta: number): number {
  let score = 0;

  if (candidate.rulePriority !== null) {
    // Every rule match is worth most of the weight; priority only separates one
    // rule from another, so a low-priority rule still beats bare history.
    score +=
      UPSELL_WEIGHTS.rule - Math.min(Math.max(candidate.rulePriority, 0), 100) / 10;
  }

  score +=
    (Math.min(candidate.coPurchaseCount, CO_PURCHASE_SATURATION) /
      CO_PURCHASE_SATURATION) *
    UPSELL_WEIGHTS.coPurchase;

  if (candidate.promoted) score += UPSELL_WEIGHTS.promoted;

  const lift = Math.min(Math.max(marginDelta, 0), MARGIN_DELTA_CEILING);
  score += (lift / MARGIN_DELTA_CEILING) * UPSELL_WEIGHTS.margin;

  return Math.round(score * 10) / 10;
}

/**
 * Why this suggestion is here, in the rep's words. One reason, not all of them:
 * a panel that explains itself in a clause gets read, and a list where every row
 * recites four factors gets ignored.
 */
export function upsellReason(candidate: UpsellCandidate, marginDelta: number): string {
  if (candidate.promoted) return "Promoted this quarter";
  if (candidate.coPurchaseCount >= 2) {
    return `Bought together ${candidate.coPurchaseCount} times`;
  }
  if (candidate.rulePriority !== null) return "Pairs with this deal";
  if (marginDelta > 0) return "Lifts blended margin";
  return "Related product";
}

/* ------------------------------------------------------------------ *
 * Deal health
 * ------------------------------------------------------------------ */

export type DealHealthQuotation = {
  id: string;
  reference: string | null;
  status: string | null;
  customer_name?: string | null;
  customer?: { name: string | null } | null;
  rep_id?: string | null;
  net_total: number | null;
  margin_total: number | null;
  max_discount_pct: number | null;
  updated_at: string | null;
  submitted_at: string | null;
  /** The date the quote was promised good until. Drives slippage. */
  valid_until?: string | null;
};

/** Fallback when a status has no SLA of its own. */
export const STALLED_AFTER_DAYS = 14;

/**
 * How long a deal may sit in each stage before it counts as stalled, in
 * business days.
 *
 * Per status, because the stages mean different things. A draft is the rep's own
 * to sit on for a while; a quote parked in front of an approver is somebody
 * else's queue and goes stale in days; an approved quote nobody has closed is
 * the most expensive kind of silence, because the discount has already been
 * given away. Weekends do not count — a quote submitted on Friday is not stale
 * on Monday, and counting calendar days would flag every deal each Monday.
 */
export const STALLED_AFTER_BY_STATUS: Record<string, number> = {
  draft: 10,
  pending_approval: 3,
  returned: 3,
  approved: 5,
};

/** Discount depth (percent) that is anomalous whatever the rep usually quotes. */
export const DISCOUNT_ANOMALY_PCT = 35;

/**
 * How far above their own baseline a rep may go before it is worth a look:
 * half as deep again, and at least this many points clear in absolute terms.
 * Both, because 3% against a 2% baseline is 50% deeper and means nothing.
 */
export const ANOMALY_BASELINE_MULTIPLE = 1.5;
export const ANOMALY_MIN_POINTS_OVER = 8;

/** Statuses that are finished. A closed deal cannot stall. */
const CLOSED_STATUSES = new Set(["won", "lost", "rejected"]);

/**
 * Whether a deal has gone quiet for longer than its stage allows.
 *
 * The clock runs from the last thing that happened to it — submission for a
 * quote awaiting approval, since that is when it became someone else's problem,
 * and the last edit otherwise.
 */
export function isStalled(
  quotation: DealHealthQuotation,
  now: Date = new Date(),
): boolean {
  const status = quotation.status ?? "draft";
  if (CLOSED_STATUSES.has(status)) return false;

  const since =
    status === "pending_approval"
      ? (quotation.submitted_at ?? quotation.updated_at)
      : quotation.updated_at;

  if (!since) return false;

  const from = new Date(since);
  if (Number.isNaN(from.getTime())) return false;

  const limit = STALLED_AFTER_BY_STATUS[status] ?? STALLED_AFTER_DAYS;
  return businessDaysBetween(from, now) > limit;
}

/** How long a deal has been sitting, in business days. Null when unknown. */
export function daysStalled(
  quotation: DealHealthQuotation,
  now: Date = new Date(),
): number | null {
  const since =
    quotation.status === "pending_approval"
      ? (quotation.submitted_at ?? quotation.updated_at)
      : quotation.updated_at;

  if (!since) return null;

  const from = new Date(since);
  return Number.isNaN(from.getTime()) ? null : businessDaysBetween(from, now);
}

/**
 * Whether this discount is out of character.
 *
 * Two tests, and either is enough. The absolute one catches a depth nobody
 * should be quoting whatever their history. The relative one is the point of the
 * feature: a rep who normally lands at 8% and has just written 22% is worth a
 * question, even though 22% would be unremarkable from someone else. Pass their
 * baseline — the mean depth across their own closed quotations — and it is used;
 * omit it and only the absolute test runs, so a new rep with no history is never
 * flagged for having none.
 */
export function isDiscountAnomaly(
  quotation: DealHealthQuotation,
  baseline?: number | null,
): boolean {
  const depth = Number(quotation.max_discount_pct ?? 0);
  if (depth >= DISCOUNT_ANOMALY_PCT) return true;

  if (baseline === null || baseline === undefined || baseline <= 0) return false;

  return (
    depth >= baseline * ANOMALY_BASELINE_MULTIPLE &&
    depth - baseline >= ANOMALY_MIN_POINTS_OVER
  );
}

/**
 * Whether the date the customer was promised has already passed while the deal
 * is still open — the quote is being worked past its own expiry, so whatever was
 * promised alongside it has slipped too.
 */
export function hasSlippedPromise(
  quotation: DealHealthQuotation,
  now: Date = new Date(),
): boolean {
  const status = quotation.status ?? "draft";
  if (CLOSED_STATUSES.has(status)) return false;
  if (!quotation.valid_until) return false;

  const due = new Date(quotation.valid_until);
  return !Number.isNaN(due.getTime()) && due < startOfDay(now);
}

/**
 * A rep's usual discount depth, from their own history. Null when they have too
 * little for a mean to mean anything.
 */
export const BASELINE_MIN_QUOTATIONS = 3;

export function discountBaseline(depths: number[]): number | null {
  const usable = depths.filter((depth) => Number.isFinite(depth) && depth >= 0);
  if (usable.length < BASELINE_MIN_QUOTATIONS) return null;

  return usable.reduce((sum, depth) => sum + depth, 0) / usable.length;
}

/** Whole business days from `from` to `to`, weekends excluded. */
export function businessDaysBetween(from: Date, to: Date): number {
  const start = startOfDay(from);
  const end = startOfDay(to);
  if (end <= start) return 0;

  let days = 0;
  const cursor = new Date(start);

  // Day by day rather than by arithmetic on whole weeks: the range here is days
  // to weeks, and stepping is the version that is obviously correct.
  while (cursor < end) {
    cursor.setDate(cursor.getDate() + 1);
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) days += 1;
  }

  return days;
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

/* ------------------------------------------------------------------ *
 * Replenishment
 * ------------------------------------------------------------------ */

export const STOCK_HEALTH = ["healthy", "low", "critical", "out"] as const;
export type StockHealth = (typeof STOCK_HEALTH)[number];

export const STOCK_HEALTH_LABELS: Record<StockHealth, string> = {
  healthy: "Healthy",
  low: "At reorder point",
  critical: "Below reorder point",
  out: "Out of stock",
};

export type ReplenishmentRule = {
  reorderPoint: number;
  reorderQty: number;
  leadTimeDays: number;
};

/**
 * How worried to be about one warehouse's holding of one product.
 *
 * Four bands rather than a boolean because "needs reordering" and "cannot ship
 * today" are different emergencies and get answered by different people. Out of
 * stock is called out even where no rule exists: a warehouse holding zero is a
 * fact worth showing whether or not anybody has written a reorder point for it.
 */
export function stockHealth(
  available: number,
  rule: ReplenishmentRule | null,
): StockHealth {
  if (available <= 0) return "out";
  if (!rule) return "healthy";
  if (available < rule.reorderPoint) return "critical";
  if (available === rule.reorderPoint) return "low";
  return "healthy";
}

/**
 * How much to bring in, in whole multiples of the reorder quantity.
 *
 * Ordering the exact shortfall would put the line back at its reorder point,
 * where the next unit shipped trips the rule again. Rounding up to a multiple
 * of the reorder quantity is also how suppliers actually sell — in cases and
 * pallets, not in ones.
 */
export function suggestedOrderQty(
  available: number,
  rule: ReplenishmentRule,
): number {
  const target = rule.reorderPoint + rule.reorderQty;
  const shortfall = target - available;
  if (shortfall <= 0) return 0;

  return Math.ceil(shortfall / rule.reorderQty) * rule.reorderQty;
}

/**
 * The date an order placed today would land.
 *
 * Calendar days, not business days: a lead time quoted by a supplier is a
 * calendar promise, unlike the desk's own SLAs which are measured in working
 * days because a desk does not work weekends.
 */
export function expectedArrival(rule: ReplenishmentRule, from: Date = new Date()): Date {
  const arrival = new Date(from);
  arrival.setDate(arrival.getDate() + rule.leadTimeDays);
  return arrival;
}

/** View models for the rep dashboard. */

export type RepStats = {
  activeQuotations: number;
  /** Share of this month's quotations that reached `approved`, 0–100. */
  approvedThisMonthPct: number;
  /** Percentage-point change against last month. */
  approvedDeltaPct: number;
  avgDiscountPct: number;
  pendingCustomerResponses: number;
};

/** One day on the pipeline chart: how many quotes, and how much they were worth. */
export type PipelinePoint = {
  /** ISO date, used for range slicing. */
  date: string;
  /** Short axis label. */
  label: string;
  created: number;
  value: number;
};

export type RangeKey = "1W" | "1M" | "3M" | "1Y" | "ALL";

/** Days of history each range tab shows; ALL means everything loaded. */
export const RANGE_DAYS: Record<RangeKey, number> = {
  "1W": 7,
  "1M": 30,
  "3M": 90,
  "1Y": 365,
  ALL: Number.POSITIVE_INFINITY,
};

export type StatusSlice = {
  status: string;
  count: number;
  value: number;
};

export type CategorySlice = {
  category: string;
  value: number;
};

export type PipelineValue = {
  total: number;
  margin: number;
  /** Blended margin as a fraction of net, or null when there is no value. */
  marginPct: number | null;
  bestCustomer: string | null;
};

/** A deal pinned in the sidebar rail. */
export type WatchlistDeal = {
  id: string;
  customer: string;
  amount: number;
  discountPct: number;
};

export type TimelineStepKey = "sent" | "negotiation" | "confirmed";

export type TimelineStep = {
  key: TimelineStepKey;
  label: string;
  done: boolean;
};

export type TopCustomer = {
  name: string;
  reference: string;
  amount: number;
  steps: TimelineStep[];
};

export type RecentQuotation = {
  id: string;
  customer: string;
  products: string[];
  discountPct: number;
  status: string;
  amount: number;
  date: string;
};

export const EMPTY_STATS: RepStats = {
  activeQuotations: 0,
  approvedThisMonthPct: 0,
  approvedDeltaPct: 0,
  avgDiscountPct: 0,
  pendingCustomerResponses: 0,
};

// Palette and labels live in lib/status.ts so every page shares one source.
export { STATUS_COLORS, statusColor, statusLabel } from "@/lib/status";

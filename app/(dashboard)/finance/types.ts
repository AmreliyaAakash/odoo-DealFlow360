/** View models for the finance dashboard. */

export type FinanceStats = {
  pendingFinanceApprovals: number;
  activeSubscriptions: number;
  backorderedItems: number;
  /** Monthly recurring revenue, all cadences normalised to one month. */
  mrr: number;
};

export type MrrPoint = {
  /** ISO date of the week start. */
  date: string;
  /** Short axis label, e.g. "12 Aug". */
  label: string;
  mrr: number;
};

export type WarehouseStockRow = {
  warehouseId: string;
  name: string;
  code: string;
  region: string | null;
  /** Units on hand across every product. */
  onHand: number;
  /** Units committed to open quotations. */
  committed: number;
  /** Share of the busiest warehouse, 0–1, for the bar width. */
  share: number;
  /** Products where committed exceeds on-hand. */
  shortages: number;
};

export type QueueKind = "one_time" | "subscription";

export type SplitStatus = "unallocated" | "partial" | "allocated" | "backordered";

export type QueueRow = {
  id: string;
  reference: string;
  customer: string;
  kind: QueueKind;
  amount: number;
  /** Monthly recurring portion, zero for one-time only quotes. */
  mrr: number;
  splitStatus: SplitStatus;
  /** Units still to allocate. */
  outstandingUnits: number;
  nextBillDate: string | null;
  status: string;
};

export const EMPTY_FINANCE_STATS: FinanceStats = {
  pendingFinanceApprovals: 0,
  activeSubscriptions: 0,
  backorderedItems: 0,
  mrr: 0,
};

export const SPLIT_LABELS: Record<SplitStatus, string> = {
  unallocated: "Not allocated",
  partial: "Partly allocated",
  allocated: "Allocated",
  backordered: "Backordered",
};

export const SPLIT_STYLES: Record<SplitStatus, string> = {
  unallocated: "bg-muted text-muted-foreground",
  partial: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  allocated: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  backordered: "bg-red-500/10 text-red-600 dark:text-red-400",
};

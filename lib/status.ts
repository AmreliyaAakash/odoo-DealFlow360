/** Shared status vocabulary, so every chart slice, badge and pill agrees. */

export const QUOTATION_STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "returned",
  "rejected",
  "won",
  "lost",
] as const;

export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];

export const STATUS_COLORS: Record<string, string> = {
  draft: "#a1a1aa",
  pending_approval: "#f59e0b",
  approved: "#6366f1",
  returned: "#fb923c",
  rejected: "#ef4444",
  won: "#10b981",
  lost: "#71717a",
};

export function statusColor(status: string): string {
  return STATUS_COLORS[status] ?? "#a1a1aa";
}

export function statusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

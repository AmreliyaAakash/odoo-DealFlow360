"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  DotsThreeIcon,
  FunnelSimpleIcon,
  ReceiptIcon,
} from "@phosphor-icons/react";
import { formatCurrency } from "@/lib/quotations";
import { cn } from "@/lib/utils";
import { statusColor, statusLabel, type RecentQuotation } from "./types";

const STATUSES = [
  "all",
  "draft",
  "pending_approval",
  "approved",
  "rejected",
  "returned",
  "won",
  "lost",
] as const;

export function RecentQuotations({
  quotations,
  search,
  status,
  onStatusChange,
}: {
  quotations: RecentQuotation[];
  /** Driven by the header's search box, so one field filters the whole page. */
  search: string;
  status: string;
  onStatusChange: (status: string) => void;
}) {
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return quotations.filter((quotation) => {
      if (status !== "all" && quotation.status !== status) return false;
      if (!needle) return true;

      return (
        quotation.customer.toLowerCase().includes(needle) ||
        quotation.products.some((product) => product.toLowerCase().includes(needle))
      );
    });
  }, [quotations, search, status]);

  return (
    <section
      className="df-rise-in rounded-xl bg-card p-4 ring-1 ring-foreground/10"
      style={{ "--df-delay": "420ms" } as React.CSSProperties}
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <ReceiptIcon size={16} className="text-muted-foreground" />
          <h2 className="text-sm font-semibold">Recent Quotations</h2>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <FunnelSimpleIcon size={14} className="text-muted-foreground" />
          <select
            value={status}
            onChange={(event) => onStatusChange(event.target.value)}
            aria-label="Filter by status"
            className="h-8 rounded-lg bg-muted/60 px-2 text-xs capitalize outline-none ring-1 ring-transparent transition focus-visible:bg-background focus-visible:ring-indigo-500"
          >
            {STATUSES.map((option) => (
              <option key={option} value={option}>
                {option === "all" ? "All statuses" : statusLabel(option)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[42rem] border-collapse text-xs">
          <thead>
            <tr className="text-left text-[11px] text-muted-foreground">
              <th className="px-2 py-2 font-medium">Customer</th>
              <th className="px-2 py-2 font-medium">Product(s)</th>
              <th className="px-2 py-2 text-right font-medium">Discount%</th>
              <th className="px-2 py-2 font-medium">Status</th>
              <th className="px-2 py-2 text-right font-medium">Amount</th>
              <th className="px-2 py-2 font-medium">Date</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((quotation, index) => (
              <tr
                // Re-keying on the filters restarts the stagger whenever the
                // visible set changes.
                key={`${search}:${status}:${quotation.id}`}
                className="df-rise-in border-t border-border/60 transition-colors hover:bg-muted/40"
                style={{ "--df-delay": `${index * 45}ms` } as React.CSSProperties}
              >
                <td className="px-2 py-2.5 font-medium">
                  <Link
                    href={`/quotations/${quotation.id}`}
                    className="hover:text-indigo-600 dark:hover:text-indigo-400"
                  >
                    {quotation.customer}
                  </Link>
                </td>
                <td className="px-2 py-2.5 text-muted-foreground">
                  {summariseProducts(quotation.products)}
                </td>
                <td className="px-2 py-2.5 text-right tabular-nums">
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                      quotation.discountPct > 25
                        ? "bg-red-500/10 text-red-600 dark:text-red-400"
                        : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                    )}
                  >
                    {quotation.discountPct.toFixed(1)}%
                  </span>
                </td>
                <td className="px-2 py-2.5">
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium capitalize"
                    style={{
                      background: `${statusColor(quotation.status)}1f`,
                      color: statusColor(quotation.status),
                    }}
                  >
                    <span
                      className="size-1.5 rounded-full"
                      style={{ background: statusColor(quotation.status) }}
                    />
                    {statusLabel(quotation.status)}
                  </span>
                </td>
                <td className="px-2 py-2.5 text-right font-medium tabular-nums">
                  {formatCurrency(quotation.amount)}
                </td>
                <td className="px-2 py-2.5 text-muted-foreground">
                  {formatDate(quotation.date)}
                </td>
                <td className="px-2 py-2.5">
                  <Link
                    href={`/quotations/${quotation.id}`}
                    aria-label={`Open quotation for ${quotation.customer}`}
                    className="text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <DotsThreeIcon size={16} weight="bold" />
                  </Link>
                </td>
              </tr>
            ))}

            {filtered.length === 0 ? (
              <tr className="border-t border-border/60">
                <td colSpan={7} className="px-2 py-6 text-center text-muted-foreground">
                  {quotations.length === 0
                    ? "No quotations yet."
                    : "No quotations match these filters."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function summariseProducts(products: string[]): string {
  if (products.length === 0) return "—";
  if (products.length <= 2) return products.join(", ");
  return `${products.slice(0, 2).join(", ")} +${products.length - 2}`;
}

function formatDate(value: string): string {
  if (!value) return "—";

  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString("en-IN", { month: "short", day: "numeric" });
}

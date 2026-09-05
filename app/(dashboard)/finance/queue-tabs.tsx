"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowsClockwiseIcon,
  ReceiptIcon,
  TruckIcon,
} from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { formatCurrency } from "@/lib/quotations";
import { cn } from "@/lib/utils";
import { Panel, PanelHeader } from "@/components/dashboard/panel";
import { SPLIT_LABELS, SPLIT_STYLES, type QueueRow } from "./types";

type Tab = "fulfillment" | "billing";

const TABS: { key: Tab; label: string; icon: typeof TruckIcon }[] = [
  { key: "fulfillment", label: "Fulfillment", icon: TruckIcon },
  { key: "billing", label: "Billing", icon: ReceiptIcon },
];

export function FulfillmentBillingQueue({ rows }: { rows: QueueRow[] }) {
  const [tab, setTab] = useState<Tab>("fulfillment");
  const reduceMotion = useReducedMotion();

  const visible = useMemo(
    () =>
      tab === "fulfillment"
        ? // Fulfilment cares about anything with stock still to move.
          rows.filter((row) => row.splitStatus !== "allocated")
        : // Billing cares about anything that recurs.
          rows.filter((row) => row.kind === "subscription"),
    [rows, tab],
  );

  return (
    <Panel delay={320}>
      <PanelHeader
        icon={tab === "fulfillment" ? TruckIcon : ReceiptIcon}
        title="Fulfillment & Billing Queue"
        caption={`${visible.length} of ${rows.length} committed quotes`}
      >
        <div className="flex items-center gap-1 rounded-lg bg-muted/60 p-0.5">
          {TABS.map((entry) => {
            const Icon = entry.icon;
            const active = tab === entry.key;

            return (
              <button
                key={entry.key}
                type="button"
                onClick={() => setTab(entry.key)}
                aria-pressed={active}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] transition-colors",
                  active
                    ? "bg-background font-medium text-emerald-700 shadow-sm dark:text-emerald-400"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon size={12} weight={active ? "fill" : "regular"} />
                {entry.label}
              </button>
            );
          })}
        </div>
      </PanelHeader>

      {/* Crossfade: the outgoing pane leaves before the incoming one enters. */}
      <div className="mt-3">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.18 }}
          >
            <QueueTable rows={visible} tab={tab} />
          </motion.div>
        </AnimatePresence>
      </div>
    </Panel>
  );
}

function QueueTable({ rows, tab }: { rows: QueueRow[]; tab: Tab }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[50rem] border-collapse text-xs">
        <thead>
          <tr className="text-left text-[11px] text-muted-foreground">
            <th className="px-2 py-2 font-medium">Quote</th>
            <th className="px-2 py-2 font-medium">Customer</th>
            <th className="w-32 px-2 py-2 font-medium">Type</th>
            <th className="w-40 px-2 py-2 font-medium">Warehouse Split</th>
            <th className="w-32 px-2 py-2 font-medium">Next Bill Date</th>
            <th className="w-28 px-2 py-2 text-right font-medium">Value</th>
            <th className="w-28 px-2 py-2 font-medium">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className="border-t border-border/60 transition-colors hover:bg-muted/40"
            >
              <td className="px-2 py-2.5 font-medium">
                <Link
                  href={`/quotations/${row.id}`}
                  className="hover:text-emerald-700 dark:hover:text-emerald-400"
                >
                  {row.reference}
                </Link>
              </td>
              <td className="px-2 py-2.5">{row.customer}</td>
              <td className="px-2 py-2.5">
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                    row.kind === "subscription"
                      ? "bg-sky-500/10 text-sky-600 dark:text-sky-400"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {row.kind === "subscription" ? (
                    <ArrowsClockwiseIcon size={10} weight="fill" />
                  ) : null}
                  {row.kind === "subscription" ? "Subscription" : "One-time"}
                </span>
              </td>
              <td className="px-2 py-2.5">
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-medium",
                    SPLIT_STYLES[row.splitStatus],
                  )}
                >
                  {SPLIT_LABELS[row.splitStatus]}
                </span>
                {row.outstandingUnits > 0 ? (
                  <span className="ml-1.5 text-[10px] tabular-nums text-muted-foreground">
                    {row.outstandingUnits} left
                  </span>
                ) : null}
              </td>
              <td className="px-2 py-2.5 text-muted-foreground">
                {formatDate(row.nextBillDate)}
              </td>
              <td className="px-2 py-2.5 text-right font-medium tabular-nums">
                {tab === "billing" && row.mrr > 0
                  ? `${formatCurrency(row.mrr)}/mo`
                  : formatCurrency(row.amount)}
              </td>
              <td className="px-2 py-2.5">
                <Link
                  href={
                    tab === "fulfillment"
                      ? `/finance/fulfillment?quote=${row.id}`
                      : `/finance/billing?quote=${row.id}`
                  }
                  className="rounded-lg bg-emerald-500 px-2.5 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-emerald-400"
                >
                  {tab === "fulfillment" ? "Allocate" : "Review"}
                </Link>
              </td>
            </tr>
          ))}

          {rows.length === 0 ? (
            <tr className="border-t border-border/60">
              <td colSpan={7} className="px-2 py-10 text-center text-muted-foreground">
                {tab === "fulfillment"
                  ? "Everything committed is fully allocated."
                  : "No active subscriptions to bill."}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function formatDate(value: string | null): string {
  if (!value) return "—";

  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { ClockIcon, CheckCircleIcon, ArrowUUpLeftIcon } from "@phosphor-icons/react";
import type { PendingApproval, SettledApproval } from "@/lib/approvals-server";
import { formatCurrency, formatNumber } from "@/lib/quotations";
import { cn } from "@/lib/utils";
import {
  DataTable,
  EmptyRow,
  Panel,
  PanelHeader,
  Td,
  Th,
  Tr,
} from "@/components/dashboard/panel";
import { PendingApprovalsTable } from "@/components/dashboard/pending-approvals-table";

/**
 * Screen 5 — the approvals board: three counters, the queue, and the history
 * behind it.
 *
 * The counters are clickable rather than decorative. "12 approved" invites the
 * question "which twelve", and a desk that has to change a filter somewhere
 * else to answer it will instead assume. Pending is the default view because
 * that is the only bucket anyone can act on.
 */

type View = "pending" | "returned" | "approved";

export function ApprovalsBoard({
  pending,
  returned,
  approved,
  canDecide,
}: {
  pending: PendingApproval[];
  returned: SettledApproval[];
  approved: SettledApproval[];
  canDecide: boolean;
}) {
  const [view, setView] = useState<View>("pending");

  return (
    <>
      {/* Top 3 Stat Cards */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Counter
          label="Pending Approvals"
          count={pending.length}
          subtitle="Waiting on desk sign-off"
          icon={ClockIcon}
          tint="bg-amber-500/10 text-amber-600 dark:text-amber-400"
          active={view === "pending"}
          onClick={() => setView("pending")}
        />
        <Counter
          label="Returned Deals"
          count={returned.length}
          subtitle="Sent back for rep revision"
          icon={ArrowUUpLeftIcon}
          tint="bg-rose-500/10 text-rose-600 dark:text-rose-400"
          active={view === "returned"}
          onClick={() => setView("returned")}
        />
        <Counter
          label="Approved Deals"
          count={approved.length}
          subtitle="Cleared desk & approved"
          icon={CheckCircleIcon}
          tint="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          active={view === "approved"}
          onClick={() => setView("approved")}
        />
      </div>

      {view === "pending" ? (
        <PendingApprovalsTable
          deals={pending}
          title={canDecide ? "Waiting on you" : "In review"}
          delay={80}
          canDecide={canDecide}
          emptyText={
            canDecide
              ? "Nothing is waiting on you."
              : "None of your deals are in review."
          }
        />
      ) : (
        <SettledTable
          rows={view === "returned" ? returned : approved}
          title={view === "returned" ? "Sent back to the rep" : "Cleared the desk"}
          caption={
            view === "returned"
              ? "Waiting on an edit before they come back to the queue"
              : "Approved or already won, most recent first"
          }
        />
      )}
    </>
  );
}

function Counter({
  label,
  count,
  subtitle,
  icon: Icon,
  tint,
  active,
  onClick,
}: {
  label: string;
  count: number;
  subtitle: string;
  icon: React.ComponentType<{ size?: number; weight?: "fill" }>;
  tint: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "group flex flex-col justify-between rounded-xl p-4 text-left transition-colors ring-1",
        active
          ? "bg-card ring-foreground/25 shadow-xs"
          : "bg-card/60 ring-foreground/10 hover:bg-muted/50 hover:ring-foreground/15",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-lg",
              tint,
            )}
          >
            <Icon size={15} weight="fill" />
          </span>
          <p className="truncate text-xs font-medium text-foreground">{label}</p>
        </div>
        {active && (
          <span className="flex size-1.5 rounded-full bg-foreground shrink-0" />
        )}
      </div>

      <div className="mt-3">
        <p className="text-2xl font-semibold tracking-tight tabular-nums text-foreground">
          {formatNumber(count)}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground truncate">{subtitle}</p>
      </div>
    </button>
  );
}

function SettledTable({
  rows,
  title,
  caption,
}: {
  rows: SettledApproval[];
  title: string;
  caption: string;
}) {
  return (
    <Panel delay={80}>
      <PanelHeader icon={CheckCircleIcon} title={title} caption={caption} />

      <div className="mt-3">
        <DataTable
          minWidth="46rem"
          head={
            <>
              <Th>Reference</Th>
              <Th>Rep</Th>
              <Th>Customer</Th>
              <Th className="w-24 text-right">Discount</Th>
              <Th className="w-28 text-right">Amount</Th>
              <Th className="w-28">Status</Th>
            </>
          }
        >
          {rows.map((row) => (
            <Tr key={row.id}>
              <Td className="font-medium">
                <Link
                  href={`/approvals/${row.id}`}
                  className="hover:text-amber-600 dark:hover:text-amber-400"
                >
                  {row.reference}
                </Link>
              </Td>
              <Td className="text-muted-foreground">{row.repName}</Td>
              <Td>{row.customer}</Td>
              <Td className="text-right tabular-nums">
                {row.maxDiscountPct.toFixed(0)}%
              </Td>
              <Td className="text-right font-medium tabular-nums">
                {formatCurrency(row.amount)}
              </Td>
              <Td className="capitalize text-[11px] text-muted-foreground">
                {row.status}
              </Td>
            </Tr>
          ))}

          {rows.length === 0 ? (
            <EmptyRow colSpan={6}>Nothing here yet.</EmptyRow>
          ) : null}
        </DataTable>
      </div>
    </Panel>
  );
}

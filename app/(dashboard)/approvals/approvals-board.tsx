"use client";

import { useState } from "react";
import Link from "next/link";
import { ClockIcon, CheckCircleIcon, ArrowUUpLeftIcon } from "@phosphor-icons/react";
import type { PendingApproval, SettledApproval } from "@/lib/approvals-server";
import { formatCurrency } from "@/lib/quotations";
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
      <div className="grid gap-3 sm:grid-cols-3">
        <Counter
          label="Pending"
          count={pending.length}
          icon={ClockIcon}
          tone="amber"
          active={view === "pending"}
          onClick={() => setView("pending")}
        />
        <Counter
          label="Returned"
          count={returned.length}
          icon={ArrowUUpLeftIcon}
          tone="red"
          active={view === "returned"}
          onClick={() => setView("returned")}
        />
        <Counter
          label="Approved"
          count={approved.length}
          icon={CheckCircleIcon}
          tone="emerald"
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

const TONES = {
  amber: "text-amber-600 dark:text-amber-400",
  red: "text-red-600 dark:text-red-400",
  emerald: "text-emerald-600 dark:text-emerald-400",
} as const;

function Counter({
  label,
  count,
  icon: Icon,
  tone,
  active,
  onClick,
}: {
  label: string;
  count: number;
  icon: React.ComponentType<{ size?: number; weight?: "fill" }>;
  tone: keyof typeof TONES;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-center gap-3 rounded-xl bg-card p-3 text-left ring-1 transition-colors",
        active
          ? "ring-2 ring-foreground/20"
          : "ring-foreground/5 hover:bg-muted/40",
      )}
    >
      <span className={cn("flex", TONES[tone])}>
        <Icon size={18} weight="fill" />
      </span>
      <span>
        <span className="block text-xl font-semibold tabular-nums">{count}</span>
        <span className="block text-[11px] text-muted-foreground">{label}</span>
      </span>
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

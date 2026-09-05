"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { ArrowsClockwiseIcon, ReceiptIcon, SquaresFourIcon, RowsIcon } from "@phosphor-icons/react";
import { formatCurrency } from "@/lib/quotations";
import { statusColor, statusLabel } from "@/lib/status";
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
import { StatusBadge } from "@/components/dashboard/status-badge";

/**
 * Screen 3 — the pipeline, as a board or as a table.
 *
 * The board is the default because the question a rep opens this screen with is
 * "where is everything stuck", and a stage column answers that at a glance in a
 * way a status column sorted by date does not. The table stays one click away
 * for the other question — "find me this one deal" — which a board is bad at.
 *
 * Both views read the same rows. Nothing is fetched on toggle, so switching is
 * instant and the two views can never disagree about what is in the pipeline.
 */

export type PipelineDeal = {
  id: string;
  reference: string;
  customer: string;
  status: string;
  value: number;
  updatedAt: string | null;
};

/** Pipeline columns, in the order deals move through them. */
const STAGES = [
  "draft",
  "pending_approval",
  "approved",
  "won",
  "lost",
] as const;

export function QuotationsView({
  deals,
  caption,
}: {
  deals: PipelineDeal[];
  caption: string;
}) {
  const router = useRouter();
  const [view, setView] = useState<"board" | "table">("board");
  const [reloading, setReloading] = useState(false);

  function handleReload() {
    setReloading(true);
    router.refresh();
    setTimeout(() => setReloading(false), 600);
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-muted-foreground">{caption}</p>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleReload}
            disabled={reloading}
            className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-xs font-medium text-foreground shadow-xs transition-colors hover:bg-muted disabled:opacity-50"
            title="Reload live quotation and stock data"
          >
            <ArrowsClockwiseIcon size={13} className={reloading ? "animate-spin" : ""} />
            Reload Data
          </button>

          <button
            type="button"
            onClick={() => setView(view === "board" ? "table" : "board")}
            className="flex h-8 items-center gap-1.5 rounded-lg bg-muted px-3 text-xs font-medium transition-colors hover:bg-muted/70"
          >
            {view === "board" ? <RowsIcon size={13} /> : <SquaresFourIcon size={13} />}
            {view === "board" ? "Switch to table view" : "Switch to board view"}
          </button>
        </div>
      </div>

      {view === "board" ? <Board deals={deals} /> : <Table deals={deals} />}
    </>
  );
}

function Board({ deals }: { deals: PipelineDeal[] }) {
  return (
    // Horizontal scroll rather than wrapping: a stage that drops onto a second
    // row stops reading as a step in a sequence.
    <div className="-mx-1 overflow-x-auto overscroll-x-contain touch-pan-y px-1 pb-1">
      <div className="grid min-w-[64rem] grid-cols-5 gap-3">
        {STAGES.map((stage, index) => {
          const inStage = deals.filter((deal) => deal.status === stage);
          const value = inStage.reduce((sum, deal) => sum + deal.value, 0);

          return (
            <Panel key={stage} delay={index * 60} className="flex flex-col p-3">
              <div className="flex items-center gap-1.5">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: statusColor(stage) }}
                />
                <p className="truncate text-[11px] font-medium">
                  {statusLabel(stage)}
                </p>
                <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                  {inStage.length}
                </span>
              </div>

              <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                {formatCurrency(value)}
              </p>

              <ul className="mt-3 flex flex-col gap-2">
                {inStage.map((deal) => (
                  <li key={deal.id}>
                    <Link
                      href={`/quotations/${deal.id}`}
                      className={cn(
                        "block rounded-lg bg-muted/50 p-2.5 ring-1 ring-foreground/5 transition-colors",
                        "hover:bg-muted",
                      )}
                    >
                      <p className="truncate text-xs font-medium">
                        {deal.customer}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {deal.reference}
                      </p>
                      <p className="mt-1.5 flex items-baseline justify-between gap-2">
                        <span className="text-xs font-medium tabular-nums">
                          {formatCurrency(deal.value)}
                        </span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {deal.updatedAt
                            ? formatDistanceToNow(new Date(deal.updatedAt), {
                                addSuffix: true,
                              })
                            : "—"}
                        </span>
                      </p>
                    </Link>
                  </li>
                ))}

                {inStage.length === 0 ? (
                  <li className="rounded-lg border border-dashed border-border py-6 text-center text-[11px] text-muted-foreground">
                    Empty
                  </li>
                ) : null}
              </ul>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}

function Table({ deals }: { deals: PipelineDeal[] }) {
  return (
    <Panel delay={60}>
      <PanelHeader
        icon={ReceiptIcon}
        title="All quotations"
        caption="Most recently updated first"
      />

      <div className="mt-3">
        <DataTable
          minWidth="38rem"
          head={
            <>
              <Th>Reference</Th>
              <Th>Customer</Th>
              <Th className="w-36">Status</Th>
              <Th className="w-28 text-right">Value</Th>
              <Th className="w-28">Updated</Th>
            </>
          }
        >
          {deals.map((deal) => (
            <Tr key={deal.id}>
              <Td className="font-medium">
                <Link
                  href={`/quotations/${deal.id}`}
                  className="hover:text-indigo-600 dark:hover:text-indigo-400"
                >
                  {deal.reference}
                </Link>
              </Td>
              <Td>{deal.customer}</Td>
              <Td>
                <StatusBadge status={deal.status} />
              </Td>
              <Td className="text-right font-medium tabular-nums">
                {formatCurrency(deal.value)}
              </Td>
              <Td className="text-muted-foreground">
                {deal.updatedAt
                  ? formatDistanceToNow(new Date(deal.updatedAt), {
                      addSuffix: true,
                    })
                  : "—"}
              </Td>
            </Tr>
          ))}

          {deals.length === 0 ? (
            <EmptyRow colSpan={5}>No quotations yet.</EmptyRow>
          ) : null}
        </DataTable>
      </div>
    </Panel>
  );
}

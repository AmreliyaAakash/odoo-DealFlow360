"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  daysStalled,
  hasSlippedPromise,
  isDiscountAnomaly,
  isStalled,
  type DealHealthQuotation,
} from "@/lib/business-logic";
import { formatCurrency } from "@/lib/quotations";
import { cn } from "@/lib/utils";
import { useSupabase } from "@/components/providers/supabase-provider";
import { DataTable, EmptyRow, Td, Th, Tr } from "@/components/dashboard/panel";
import { DiscountBadge, StatusBadge } from "@/components/dashboard/status-badge";

/**
 * B9 — open quotations with their health flags.
 *
 * The flags are computed here rather than stored, so a realtime update to a
 * quotation re-evaluates them without a second round trip: a deal that has just
 * been edited stops being stalled the moment the change lands.
 */

type Alert = "stalled" | "discount_anomaly" | "slipped";

export function DealHealthTable({
  initial,
  baselines,
  canAct,
}: {
  initial: DealHealthQuotation[];
  /** Mean discount depth per rep, from their settled deals. */
  baselines: Record<string, number>;
  /** False for a rep: they see their flagged deals but do not chase them. */
  canAct: boolean;
}) {
  const supabase = useSupabase();
  const [rows, setRows] = useState(initial);
  const [chased, setChased] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    const channel = supabase
      .channel("deal-health-quotations")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "quotations" },
        (payload) => {
          setRows((current) => mergeChange(current, payload));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  async function raise(quotationId: string, alert: Alert, action: "nudge" | "escalate") {
    setPending(quotationId);
    try {
      const response = await fetch("/api/deal-health/nudge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quotationId, alert, action }),
      });

      setChased((current) => ({
        ...current,
        [quotationId]: response.ok
          ? action === "escalate"
            ? "Escalated"
            : "Nudged"
          : "Failed",
      }));
    } catch {
      setChased((current) => ({ ...current, [quotationId]: "Failed" }));
    } finally {
      setPending(null);
    }
  }

  return (
    <DataTable
      minWidth="52rem"
      head={
        <>
          <Th>Quotation</Th>
          <Th className="w-32">Status</Th>
          <Th className="w-24 text-right">Discount</Th>
          <Th className="w-28 text-right">Value</Th>
          <Th className="w-56">Flags</Th>
          <Th className="w-40" />
        </>
      }
    >
      {rows.map((row, index) => {
        const baseline = row.rep_id ? baselines[row.rep_id] : undefined;
        const stalled = isStalled(row);
        const anomalous = isDiscountAnomaly(row, baseline);
        const slipped = hasSlippedPromise(row);
        const idle = daysStalled(row);

        // The worst thing wrong with the deal is what a chase is filed against.
        const alert: Alert | null = anomalous
          ? "discount_anomaly"
          : slipped
            ? "slipped"
            : stalled
              ? "stalled"
              : null;

        return (
          <Tr
            key={row.id}
            className="df-rise-in"
            style={{ "--df-delay": `${index * 40}ms` } as React.CSSProperties}
          >
            <Td className="font-medium">
              <Link
                href={`/quotations/${row.id}`}
                className="hover:text-indigo-600 dark:hover:text-indigo-400"
              >
                {row.reference ?? row.id}
              </Link>
            </Td>
            <Td>
              <StatusBadge status={row.status ?? "draft"} />
            </Td>
            <Td className="text-right">
              <DiscountBadge value={Number(row.max_discount_pct ?? 0)} />
            </Td>
            <Td className="text-right font-medium tabular-nums">
              {formatCurrency(Number(row.net_total ?? 0))}
            </Td>
            <Td>
              <span className="flex flex-wrap gap-1">
                {stalled ? (
                  <Flag tone="amber">
                    Stalled{idle === null ? "" : ` ${idle}d`}
                  </Flag>
                ) : null}
                {anomalous ? (
                  <Flag tone="red">
                    {baseline === undefined
                      ? "Discount anomaly"
                      : `${Math.round(Number(row.max_discount_pct ?? 0) - baseline)}pp over usual`}
                  </Flag>
                ) : null}
                {slipped ? <Flag tone="orange">Promise slipped</Flag> : null}
                {!stalled && !anomalous && !slipped ? (
                  <Flag tone="emerald">Healthy</Flag>
                ) : null}
              </span>
            </Td>
            <Td>
              {alert && canAct ? (
                chased[row.id] ? (
                  <span className="text-[11px] text-muted-foreground">
                    {chased[row.id]}
                  </span>
                ) : (
                  <span className="flex gap-1">
                    <button
                      type="button"
                      disabled={pending === row.id}
                      onClick={() => void raise(row.id, alert, "nudge")}
                      className="rounded-lg bg-muted px-2 py-1 text-[11px] font-medium transition-colors hover:bg-muted/70 disabled:opacity-50"
                    >
                      Nudge
                    </button>
                    <button
                      type="button"
                      disabled={pending === row.id}
                      onClick={() => void raise(row.id, alert, "escalate")}
                      className="rounded-lg bg-amber-500/15 px-2 py-1 text-[11px] font-medium text-amber-700 transition-colors hover:bg-amber-500/25 disabled:opacity-50 dark:text-amber-400"
                    >
                      Escalate
                    </button>
                  </span>
                )
              ) : null}
            </Td>
          </Tr>
        );
      })}

      {rows.length === 0 ? (
        <EmptyRow colSpan={6}>No open quotations.</EmptyRow>
      ) : null}
    </DataTable>
  );
}

function Flag({
  tone,
  children,
}: {
  tone: "amber" | "red" | "orange" | "emerald";
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-medium",
        tone === "amber" && "bg-amber-500/10 text-amber-600 dark:text-amber-400",
        tone === "red" && "bg-red-500/10 text-red-600 dark:text-red-400",
        tone === "orange" && "bg-orange-500/10 text-orange-600 dark:text-orange-400",
        tone === "emerald" &&
          "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      )}
    >
      {children}
    </span>
  );
}

type Change = {
  eventType: string;
  new: Record<string, unknown>;
  old: Record<string, unknown>;
};

/** Applies one realtime change to the visible rows, keyed by id. */
function mergeChange(
  current: DealHealthQuotation[],
  payload: Change,
): DealHealthQuotation[] {
  if (payload.eventType === "DELETE") {
    const id = payload.old?.id as string | undefined;
    return id ? current.filter((row) => row.id !== id) : current;
  }

  const row = payload.new as unknown as DealHealthQuotation | undefined;
  if (!row?.id) return current;

  const index = current.findIndex((existing) => existing.id === row.id);
  if (index === -1) return [row, ...current];

  const next = [...current];
  next[index] = row;
  return next;
}

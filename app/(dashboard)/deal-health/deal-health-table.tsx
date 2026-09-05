"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  isDiscountAnomaly,
  isStalled,
  type DealHealthQuotation,
} from "@/lib/business-logic";
import { formatCurrency } from "@/lib/quotations";
import { useSupabase } from "@/lib/supabase";
import { DataTable, EmptyRow, Td, Th, Tr } from "@/components/dashboard/panel";
import { DiscountBadge, StatusBadge } from "@/components/dashboard/status-badge";

export function DealHealthTable({ initial }: { initial: DealHealthQuotation[] }) {
  const supabase = useSupabase();
  const [rows, setRows] = useState(initial);

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

  return (
    <DataTable
      minWidth="42rem"
      head={
        <>
          <Th>Quotation</Th>
          <Th className="w-32">Status</Th>
          <Th className="w-24 text-right">Discount</Th>
          <Th className="w-28 text-right">Value</Th>
          <Th className="w-48">Flags</Th>
        </>
      }
    >
      {rows.map((row, index) => {
        const stalled = isStalled(row);
        const anomalous = isDiscountAnomaly(row);

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
                  <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                    Stalled
                  </span>
                ) : null}
                {anomalous ? (
                  <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400">
                    Discount anomaly
                  </span>
                ) : null}
                {!stalled && !anomalous ? (
                  <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                    Healthy
                  </span>
                ) : null}
              </span>
            </Td>
          </Tr>
        );
      })}

      {rows.length === 0 ? (
        <EmptyRow colSpan={5}>No open quotations.</EmptyRow>
      ) : null}
    </DataTable>
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

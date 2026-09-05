"use client";

import { useState } from "react";
import { ArrowsSplitIcon, WarehouseIcon } from "@phosphor-icons/react";
import type {
  SplitAllocation,
  SplitRequestLine,
  WarehouseSplitResponse,
} from "@/app/api/warehouse-split/route";
import {
  DataTable,
  EmptyRow,
  Notice,
  Panel,
  PanelHeader,
  Td,
  Th,
  Tr,
} from "@/components/dashboard/panel";

/** B6 — STRUCTURE ONLY: the allocation engine is a stub. */

export function WarehouseSplitView({ lines }: { lines: SplitRequestLine[] }) {
  const [split, setSplit] = useState<WarehouseSplitResponse | null>(null);
  const [manualOverride, setManualOverride] = useState(false);
  const [loading, setLoading] = useState(false);

  async function loadSplit() {
    setLoading(true);
    try {
      const response = await fetch("/api/warehouse-split", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines }),
      });
      setSplit(await response.json());
    } finally {
      setLoading(false);
    }
  }

  // TODO(B6): when `manualOverride` is on, make qty editable per allocation row
  // and post the adjusted split back.
  const allocations: SplitAllocation[] = split?.allocations ?? [];

  return (
    <Panel>
      <PanelHeader
        icon={ArrowsSplitIcon}
        title="Warehouse split"
        caption={`${lines.length} line${lines.length === 1 ? "" : "s"} to allocate`}
      >
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <input
            type="checkbox"
            checked={manualOverride}
            onChange={(event) => setManualOverride(event.target.checked)}
            className="accent-indigo-500"
          />
          Manual override
        </label>
        <button
          type="button"
          onClick={loadSplit}
          disabled={loading}
          className="rounded-lg bg-muted px-2.5 py-1.5 text-[11px] font-medium transition-colors hover:bg-muted/70 disabled:opacity-50"
        >
          {loading ? "Calculating..." : "Recalculate"}
        </button>
      </PanelHeader>

      <div className="mt-3">
        <DataTable
          minWidth="34rem"
          head={
            <>
              <Th>Warehouse</Th>
              <Th>Product</Th>
              <Th className="w-24 text-right">Qty</Th>
              <Th className="w-28">Source</Th>
            </>
          }
        >
          {allocations.map((allocation, index) => (
            <Tr
              key={`${allocation.warehouseId}:${allocation.productId}:${index}`}
              className="df-rise-in"
              style={{ "--df-delay": `${index * 40}ms` } as React.CSSProperties}
            >
              <Td className="font-medium">
                <span className="flex items-center gap-1.5">
                  <WarehouseIcon size={13} className="text-muted-foreground" />
                  {allocation.warehouseName}
                </span>
              </Td>
              <Td className="text-muted-foreground">{allocation.productId}</Td>
              <Td className="text-right tabular-nums">{allocation.qty}</Td>
              <Td>
                <span
                  className={
                    allocation.manual
                      ? "rounded-full bg-indigo-500/10 px-2 py-0.5 text-[10px] font-medium text-indigo-600 dark:text-indigo-300"
                      : "rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                  }
                >
                  {allocation.manual ? "Manual" : "Suggested"}
                </span>
              </Td>
            </Tr>
          ))}

          {allocations.length === 0 ? (
            <EmptyRow colSpan={4}>No split calculated yet.</EmptyRow>
          ) : null}
        </DataTable>
      </div>

      {split?.shortfalls.length ? (
        <div className="mt-3">
          <Notice tone="danger">
            {split.shortfalls.length} line(s) could not be fully allocated from stock.
          </Notice>
        </div>
      ) : null}
    </Panel>
  );
}

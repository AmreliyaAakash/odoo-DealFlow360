"use client";

import { useState } from "react";
import type {
  SplitAllocation,
  SplitRequestLine,
  WarehouseSplitResponse,
} from "@/app/api/warehouse-split/route";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/** B6 — STRUCTURE ONLY. */

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
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-sm font-semibold">Warehouse split</h2>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={manualOverride}
              onChange={(event) => setManualOverride(event.target.checked)}
            />
            Manual override
          </label>
          <Button size="xs" variant="outline" onClick={loadSplit} disabled={loading}>
            {loading ? "Calculating…" : "Recalculate"}
          </Button>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Warehouse</TableHead>
            <TableHead>Product</TableHead>
            <TableHead className="w-24 text-right">Qty</TableHead>
            <TableHead className="w-24">Source</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {allocations.map((allocation, index) => (
            <TableRow key={`${allocation.warehouseId}:${allocation.productId}:${index}`}>
              <TableCell>{allocation.warehouseName}</TableCell>
              <TableCell>{allocation.productId}</TableCell>
              <TableCell className="text-right tabular-nums">{allocation.qty}</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {allocation.manual ? "Manual" : "Suggested"}
              </TableCell>
            </TableRow>
          ))}
          {allocations.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="text-muted-foreground">
                No split calculated yet.
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>

      {split?.shortfalls.length ? (
        <p className="text-xs text-destructive">
          {split.shortfalls.length} line(s) could not be fully allocated.
        </p>
      ) : null}
    </div>
  );
}

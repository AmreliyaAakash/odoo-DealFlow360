"use client";

import { useCallback, useState } from "react";
import {
  ArrowsSplitIcon,
  CheckCircleIcon,
  PackageIcon,
  WarehouseIcon,
} from "@phosphor-icons/react";
import type {
  SplitAllocation,
  WarehouseSplitResponse,
} from "@/lib/warehouse-split-server";
import { formatNumber } from "@/lib/quotations";
import { cn } from "@/lib/utils";
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

/**
 * B6 — the fulfilment split for one quotation.
 *
 * Two tables rather than one: what is already committed to a warehouse, and what
 * the engine proposes for whatever is left. Keeping them apart is what makes the
 * backorder story readable — after stock lands, the committed half does not
 * move and the proposal fills in the gap.
 */

type Draft = Record<string, number>;

export function WarehouseSplitView({
  quotationId,
  canCommit,
  initial,
}: {
  quotationId: string;
  /** False for a reviewer: they see the split but cannot accept it. */
  canCommit: boolean;
  /**
   * The split as the server already computed it. Rendered straight away rather
   * than fetched on mount, so the panel arrives filled in and the only round
   * trips are the ones a person asks for.
   */
  initial: WarehouseSplitResponse;
}) {
  const [split, setSplit] = useState<WarehouseSplitResponse>(initial);
  const [manualOverride, setManualOverride] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => seedDraft(initial));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/warehouse-split", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quotationId }),
      });
      const body = await response.json();

      if (!response.ok) {
        setError(body.error ?? "Could not calculate the split");
        return;
      }

      setSplit(body as WarehouseSplitResponse);
      setDraft(seedDraft(body as WarehouseSplitResponse));
    } catch {
      setError("Could not reach the allocation service");
    } finally {
      setLoading(false);
    }
  }, [quotationId]);

  async function commit() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/warehouse-split", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quotationId,
          save: true,
          // Only send explicit allocations when the rep is overriding; otherwise
          // the server re-runs its own suggestion, so the split that gets saved
          // is the one it just computed from live stock rather than a stale copy.
          allocations: manualOverride ? draftToAllocations(split, draft) : undefined,
        }),
      });
      const body = await response.json();

      if (!response.ok) {
        setError(body.error ?? "Could not save the split");
        return;
      }

      setSplit(body as WarehouseSplitResponse);
      setDraft(seedDraft(body as WarehouseSplitResponse));
      setManualOverride(false);
    } catch {
      setError("Could not reach the allocation service");
    } finally {
      setSaving(false);
    }
  }

  const { committed, allocations: proposed, shortfalls } = split;
  const hasBackorder = shortfalls.length > 0;
  // Stock arrived against a partly-filled order: the proposal can close the gap.
  const consolidating = committed.length > 0 && proposed.length > 0;

  return (
    <div className="flex flex-col gap-4">
      {error ? <Notice tone="danger">{error}</Notice> : null}

      {committed.length > 0 ? (
        <Panel>
          <PanelHeader
            icon={CheckCircleIcon}
            title="Committed"
            caption={`${formatNumber(
              totalQty(committed),
            )} unit(s) reserved across ${countSites(committed)} warehouse(s)`}
          />
          <div className="mt-3">
            <AllocationTable rows={committed} />
          </div>
        </Panel>
      ) : null}

      <Panel>
        <PanelHeader
          icon={ArrowsSplitIcon}
          title={consolidating ? "Consolidate remaining backorder" : "Suggested split"}
          caption={
            split.fullyAllocated
              ? "Every ordered unit is allocated."
              : `${split.shipmentCount} shipment(s) · shipping weight ${split.shippingCost}`
          }
        >
          {canCommit && proposed.length > 0 ? (
            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <input
                type="checkbox"
                checked={manualOverride}
                onChange={(event) => {
                  setManualOverride(event.target.checked);
                  setDraft(seedDraft(split));
                }}
                className="accent-indigo-500"
              />
              Manual override
            </label>
          ) : null}

          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || saving}
            className="rounded-lg bg-muted px-2.5 py-1.5 text-[11px] font-medium transition-colors hover:bg-muted/70 disabled:opacity-50"
          >
            {loading ? "Calculating..." : "Recalculate"}
          </button>

          {canCommit ? (
            <button
              type="button"
              onClick={() => void commit()}
              disabled={saving || loading || proposed.length === 0}
              className="rounded-lg bg-zinc-900 px-2.5 py-1.5 text-[11px] font-medium text-zinc-50 transition-colors hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {saving
                ? "Saving..."
                : manualOverride
                  ? "Save override"
                  : consolidating
                    ? "Consolidate"
                    : "Accept suggested split"}
            </button>
          ) : null}
        </PanelHeader>

        <div className="mt-3">
          <AllocationTable
            rows={proposed}
            editable={manualOverride}
            draft={draft}
            onQty={(key, qty) => setDraft((current) => ({ ...current, [key]: qty }))}
            empty={
              split.fullyAllocated
                ? "Nothing left to allocate."
                : hasBackorder
                  ? "No stock available for the outstanding quantity."
                  : "No split calculated yet."
            }
          />
        </div>

        {hasBackorder ? (
          <div className="mt-3">
            <Notice>
              {formatNumber(
                shortfalls.reduce((sum, line) => sum + line.qty, 0),
              )}{" "}
              unit(s) across {shortfalls.length} line(s) are on backorder. Once stock
              arrives, recalculate and consolidate — only the outstanding quantity is
              allocated, so nothing is committed twice.
            </Notice>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}

function AllocationTable({
  rows,
  editable = false,
  draft,
  onQty,
  empty = "Nothing to show.",
}: {
  rows: SplitAllocation[];
  editable?: boolean;
  draft?: Draft;
  onQty?: (key: string, qty: number) => void;
  empty?: string;
}) {
  return (
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
      {rows.map((allocation, index) => {
        const key = rowKey(allocation);

        return (
          <Tr
            key={`${key}:${index}`}
            className="df-rise-in"
            style={{ "--df-delay": `${index * 40}ms` } as React.CSSProperties}
          >
            <Td className="font-medium">
              <span className="flex items-center gap-1.5">
                <WarehouseIcon size={13} className="text-muted-foreground" />
                {allocation.warehouseName}
              </span>
            </Td>
            <Td className="text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <PackageIcon size={13} />
                {allocation.productName}
              </span>
            </Td>
            <Td className="text-right tabular-nums">
              {editable ? (
                <input
                  type="number"
                  min={0}
                  max={allocation.qty}
                  value={draft?.[key] ?? allocation.qty}
                  onChange={(event) =>
                    onQty?.(key, clamp(event.target.valueAsNumber, allocation.qty))
                  }
                  className="w-20 rounded-lg bg-muted px-2 py-1 text-right text-xs tabular-nums outline-none ring-1 ring-transparent focus:ring-indigo-500/40"
                />
              ) : (
                formatNumber(allocation.qty)
              )}
            </Td>
            <Td>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-medium",
                  allocation.manual
                    ? "bg-indigo-500/10 text-indigo-600 dark:text-indigo-300"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {allocation.manual ? "Manual" : "Suggested"}
              </span>
            </Td>
          </Tr>
        );
      })}

      {rows.length === 0 ? <EmptyRow colSpan={4}>{empty}</EmptyRow> : null}
    </DataTable>
  );
}

/** One row's identity: the warehouse and product it moves between. */
function rowKey(allocation: SplitAllocation): string {
  return `${allocation.warehouseId}:${allocation.productId}`;
}

function seedDraft(split: WarehouseSplitResponse): Draft {
  return Object.fromEntries(
    split.allocations.map((row) => [rowKey(row), row.qty]),
  );
}

/**
 * The override never invents new allocations, it only trims the suggested ones —
 * so a rep can pull a line off a distant warehouse and leave it on backorder,
 * without being able to promise stock the shelf does not have.
 */
function draftToAllocations(split: WarehouseSplitResponse, draft: Draft) {
  return split.allocations
    .map((row) => ({
      warehouseId: row.warehouseId,
      productId: row.productId,
      qty: draft[rowKey(row)] ?? row.qty,
    }))
    .filter((row) => row.qty > 0);
}

function clamp(value: number, max: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(Math.floor(value), max);
}

function totalQty(rows: SplitAllocation[]): number {
  return rows.reduce((sum, row) => sum + row.qty, 0);
}

function countSites(rows: SplitAllocation[]): number {
  return new Set(rows.map((row) => row.warehouseId)).size;
}

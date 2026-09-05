"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowsClockwiseIcon,
  WarehouseIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { STOCK_HEALTH_LABELS, type StockHealth } from "@/lib/business-logic";
import { formatNumber } from "@/lib/quotations";
import { cellKey, type StockBoard } from "@/lib/stock";
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
 * A5 — the stock grid.
 *
 * A matrix rather than a list of rows because the question an admin has is
 * "where is this product", and a flat table sorted by warehouse makes that a
 * scavenger hunt. Products down the side, warehouses across the top, one number
 * per cell.
 *
 * Edits are held locally and saved in one request. Stock is corrected in
 * sweeps — a stock-take touches dozens of cells — and a save-per-keystroke
 * would turn one reconciliation into a hundred audit lines.
 */

const HEALTH_STYLES: Record<StockHealth, string> = {
  healthy: "",
  low: "text-amber-600 dark:text-amber-400",
  critical: "text-red-600 dark:text-red-400",
  out: "text-red-600 dark:text-red-400",
};

export function StockEditor({
  board,
  canWrite,
}: {
  board: StockBoard;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);

  /** Cells whose typed value differs from what is stored. */
  const pending = useMemo(() => {
    const out: { warehouseId: string; productId: string; available: number }[] =
      [];

    for (const [key, raw] of Object.entries(edits)) {
      const cell = board.cells[key];
      if (!cell) continue;

      const value = Number(raw);
      if (raw === "" || !Number.isInteger(value) || value < 0) continue;
      if (value === cell.available) continue;

      out.push({
        warehouseId: cell.warehouseId,
        productId: cell.productId,
        available: value,
      });
    }

    return out;
  }, [edits, board.cells]);

  /** Typed something that is not a whole non-negative number. */
  const invalid = useMemo(
    () =>
      Object.values(edits).some((raw) => {
        if (raw === "") return false;
        const value = Number(raw);
        return !Number.isInteger(value) || value < 0;
      }),
    [edits],
  );

  async function save() {
    setSaving(true);
    setMessage(null);

    try {
      const response = await fetch("/api/backend/stock", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cells: pending }),
      });
      const body = await response.json();

      if (!response.ok) {
        setMessage({ tone: "error", text: body?.error ?? "Could not save." });
        return;
      }

      setMessage({
        tone: "ok",
        text: `${body.updated} ${body.updated === 1 ? "figure" : "figures"} updated.`,
      });
      // Clearing the drafts before the refresh means the inputs fall back to
      // the server's numbers rather than briefly showing stale local ones.
      setEdits({});
      router.refresh();
    } catch {
      setMessage({ tone: "error", text: "Could not reach the server." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {board.error ? <Notice tone="danger">{board.error}</Notice> : null}

      <Panel>
        <PanelHeader
          icon={WarningIcon}
          title="Needs reordering"
          caption={
            board.rulesMissing
              ? "Reorder rules are not set up in this database yet"
              : board.reorders.length === 0
                ? "Every line with a reorder rule is above its point"
                : "Below or at the reorder point, emptiest first"
          }
        >
          {board.rulesMissing ? null : (
            <Link
              href="/backend/replenishment"
              className="flex h-8 items-center rounded-lg bg-muted px-3 text-[11px] font-medium transition-colors hover:bg-muted/70"
            >
              Reorder rules
            </Link>
          )}
        </PanelHeader>

        {board.rulesMissing ? (
          <div className="mt-3">
            <Notice>
              This database predates the reorder rules feature, so the
              <code className="mx-1 rounded bg-muted px-1 py-0.5 text-[10px]">
                replenishment_rules
              </code>
              table is missing. Stock levels below are live and editable. To
              turn this panel on, run
              <code className="mx-1 rounded bg-muted px-1 py-0.5 text-[10px]">
                db/repair.sql
              </code>
              in the Supabase SQL editor, then reload. For the sample rules,
              follow it with
              <code className="mx-1 rounded bg-muted px-1 py-0.5 text-[10px]">
                db/migrations/seed-reorder-rules.sql
              </code>
            </Notice>
          </div>
        ) : (
          <div className="mt-3">
            <DataTable
              minWidth="48rem"
              head={
                <>
                  <Th>Product</Th>
                  <Th className="w-32">Warehouse</Th>
                  <Th className="w-24 text-right">On hand</Th>
                  <Th className="w-24 text-right">Reorder at</Th>
                  <Th className="w-24 text-right">Order</Th>
                  <Th className="w-28">Arrives</Th>
                </>
              }
            >
              {board.reorders.map((row) => (
                <Tr key={cellKey(row.warehouseId, row.productId)}>
                  <Td className="font-medium">{row.productName}</Td>
                  <Td className="text-muted-foreground">{row.warehouseName}</Td>
                  <Td
                    className={cn(
                      "text-right font-medium tabular-nums",
                      HEALTH_STYLES[row.health],
                    )}
                  >
                    {formatNumber(row.available)}
                  </Td>
                  <Td className="text-right tabular-nums text-muted-foreground">
                    {formatNumber(row.reorderPoint)}
                  </Td>
                  <Td className="text-right font-medium tabular-nums">
                    {formatNumber(row.orderQty)}
                  </Td>
                  <Td className="text-[11px] text-muted-foreground">
                    {row.arrivesOn}
                  </Td>
                </Tr>
              ))}

              {board.reorders.length === 0 ? (
                <EmptyRow colSpan={6}>
                  Nothing needs reordering. Lines with no reorder rule are not
                  checked — add one on the Reorder rules screen.
                </EmptyRow>
              ) : null}
            </DataTable>
          </div>
        )}
      </Panel>

      <Panel delay={80}>
        <PanelHeader
          icon={WarehouseIcon}
          title="Stock on hand"
          caption={
            canWrite
              ? "Type a figure to correct it. Nothing is written until you save."
              : "Read-only for your role"
          }
        >
          {canWrite ? (
            <button
              type="button"
              onClick={save}
              disabled={saving || pending.length === 0 || invalid}
              title={
                invalid
                  ? "A figure must be a whole number, zero or more"
                  : undefined
              }
              className="flex h-8 items-center gap-1.5 rounded-lg bg-zinc-900 px-3 text-[11px] font-medium text-zinc-50 transition-colors hover:bg-zinc-800 disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
            >
              <ArrowsClockwiseIcon size={12} />
              {saving
                ? "Saving…"
                : pending.length === 0
                  ? "No changes"
                  : `Save ${pending.length} ${pending.length === 1 ? "change" : "changes"}`}
            </button>
          ) : null}
        </PanelHeader>

        {message ? (
          <div className="mt-3">
            <Notice tone={message.tone === "error" ? "danger" : undefined}>
              {message.text}
            </Notice>
          </div>
        ) : null}

        <div className="mt-3">
          <DataTable
            minWidth={`${28 + board.warehouses.length * 7}rem`}
            head={
              <>
                <Th>Product</Th>
                {board.warehouses.map((warehouse) => (
                  <Th key={warehouse.id} className="w-28 text-right">
                    {warehouse.code}
                  </Th>
                ))}
              </>
            }
          >
            {board.products.map((product) => (
              <Tr key={product.id}>
                <Td className="font-medium">
                  {product.name}
                  <span className="block text-[10px] text-muted-foreground">
                    {product.category}
                    {product.sku ? ` · ${product.sku}` : ""}
                  </span>
                </Td>

                {board.warehouses.map((warehouse) => {
                  const key = cellKey(warehouse.id, product.id);
                  const cell = board.cells[key];
                  const draft = edits[key];
                  const value = draft ?? String(cell?.available ?? 0);
                  const bad =
                    draft !== undefined &&
                    draft !== "" &&
                    (!Number.isInteger(Number(draft)) || Number(draft) < 0);

                  return (
                    <Td key={warehouse.id} className="text-right">
                      {canWrite ? (
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={value}
                          aria-label={`${product.name} at ${warehouse.name}`}
                          aria-invalid={bad || undefined}
                          onChange={(event) =>
                            setEdits((current) => ({
                              ...current,
                              [key]: event.target.value,
                            }))
                          }
                          className={cn(
                            "h-8 w-20 rounded-lg bg-muted/60 px-2 text-right text-xs tabular-nums outline-none ring-1 transition focus-visible:bg-background",
                            bad
                              ? "ring-red-500"
                              : draft !== undefined &&
                                  Number(draft) !== cell?.available
                                ? "ring-indigo-500"
                                : "ring-transparent focus-visible:ring-indigo-500",
                            cell ? HEALTH_STYLES[cell.health] : undefined,
                          )}
                        />
                      ) : (
                        <span
                          className={cn(
                            "text-xs tabular-nums",
                            cell ? HEALTH_STYLES[cell.health] : undefined,
                          )}
                        >
                          {formatNumber(cell?.available ?? 0)}
                        </span>
                      )}

                      {cell && cell.health !== "healthy" ? (
                        <span className="block text-[10px] text-muted-foreground">
                          {STOCK_HEALTH_LABELS[cell.health]}
                        </span>
                      ) : null}
                    </Td>
                  );
                })}
              </Tr>
            ))}

            {board.products.length === 0 ? (
              <EmptyRow colSpan={board.warehouses.length + 1}>
                No active products in the catalog.
              </EmptyRow>
            ) : null}
          </DataTable>
        </div>
      </Panel>
    </>
  );
}

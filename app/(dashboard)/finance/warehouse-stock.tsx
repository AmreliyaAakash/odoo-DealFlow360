"use client";

import { WarehouseIcon } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "framer-motion";
import { formatNumber } from "@/lib/quotations";
import { Panel, PanelHeader } from "@/components/dashboard/panel";
import type { WarehouseStockRow } from "./types";

/** Stock on hand per warehouse, as bars that grow in on load. */
export function WarehouseStockOverview({ rows }: { rows: WarehouseStockRow[] }) {
  const reduceMotion = useReducedMotion();
  const total = rows.reduce((sum, row) => sum + row.onHand, 0);

  return (
    <Panel delay={260} className="self-start">
      <PanelHeader
        icon={WarehouseIcon}
        title="Warehouse Stock Overview"
        caption={`${formatNumber(total)} units across ${rows.length} sites`}
        href="/finance/warehouses"
      />

      <div className="mt-3 flex flex-col gap-3">
        {rows.map((row, index) => (
          <div key={row.warehouseId}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-xs font-medium">
                {row.name}
                <span className="ml-1.5 text-[10px] text-muted-foreground">
                  {row.code}
                  {row.region ? ` · ${row.region}` : ""}
                </span>
              </span>
              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                {formatNumber(row.onHand)}
              </span>
            </div>

            <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${Math.max(row.share * 100, 2)}%` }}
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : {
                        duration: 0.7,
                        delay: 0.3 + index * 0.1,
                        ease: [0.22, 1, 0.36, 1],
                      }
                }
                className={
                  row.shortages > 0
                    ? "h-full rounded-full bg-amber-500"
                    : "h-full rounded-full bg-emerald-500"
                }
              />
            </div>

            <p className="mt-1 text-[10px] text-muted-foreground tabular-nums">
              {formatNumber(row.committed)} committed
              {row.shortages > 0 ? ` · ${row.shortages} short` : ""}
            </p>
          </div>
        ))}

        {rows.length === 0 ? (
          <p className="py-8 text-center text-[11px] text-muted-foreground">
            No active warehouses configured.
          </p>
        ) : null}
      </div>
    </Panel>
  );
}

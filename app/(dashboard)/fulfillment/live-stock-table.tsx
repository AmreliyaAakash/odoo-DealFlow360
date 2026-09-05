"use client";

import { useMemo, useState } from "react";
import {
  FunnelSimpleIcon,
  MagnifyingGlassIcon,
  PackageIcon,
} from "@phosphor-icons/react";
import { formatNumber } from "@/lib/quotations";
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

/**
 * Screen 7 — the live stock table, with its filters.
 *
 * A client component only because of the filters: the rows themselves are
 * resolved on the server and handed down whole. Every warehouse holds most of
 * the catalog, so the table is warehouses × products long and the desk's real
 * question — "how much of this one thing is where" — is a scroll away by the
 * second warehouse. Filtering in the browser rather than through the URL keeps
 * that a zero-latency narrowing of a list that is already loaded.
 */

export type StockLine = {
  key: string;
  warehouse: string;
  product: string;
  onHand: number;
  reserved: number;
  available: number;
};

const ALL = "all";

export function LiveStockTable({ stock }: { stock: StockLine[] }) {
  const [warehouse, setWarehouse] = useState(ALL);
  const [query, setQuery] = useState("");

  // Taken from the rows rather than a warehouse list, so the filter never
  // offers a site that has nothing on the shelf to show.
  const warehouses = useMemo(
    () =>
      [...new Set(stock.map((row) => row.warehouse))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [stock],
  );

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return stock.filter(
      (row) =>
        (warehouse === ALL || row.warehouse === warehouse) &&
        (needle === "" || row.product.toLowerCase().includes(needle)),
    );
  }, [stock, warehouse, query]);

  const filtering = warehouse !== ALL || query.trim() !== "";

  return (
    <Panel delay={60}>
      <PanelHeader
        icon={PackageIcon}
        title="Live stock"
        caption={
          filtering
            ? `${rows.length} of ${stock.length} lines`
            : "On hand, reserved against orders, and what is left to promise"
        }
      >
        <label className="relative">
          <MagnifyingGlassIcon
            size={14}
            className="absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search product"
            aria-label="Filter stock by product"
            className="h-8 w-44 rounded-lg bg-muted/60 pr-3 pl-8 text-xs outline-none ring-1 ring-transparent transition focus-visible:bg-background focus-visible:ring-indigo-500"
          />
        </label>

        <div className="flex items-center gap-2">
          <FunnelSimpleIcon size={14} className="text-muted-foreground" />
          <select
            value={warehouse}
            onChange={(event) => setWarehouse(event.target.value)}
            aria-label="Filter stock by warehouse"
            className="h-8 rounded-lg bg-muted/60 px-2 text-xs outline-none ring-1 ring-transparent transition focus-visible:bg-background focus-visible:ring-indigo-500"
          >
            <option value={ALL}>All warehouses</option>
            {warehouses.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
      </PanelHeader>

      <div className="mt-3">
        <DataTable
          minWidth="42rem"
          head={
            <>
              <Th>Warehouse</Th>
              <Th>Product</Th>
              <Th className="w-24 text-right">On hand</Th>
              <Th className="w-24 text-right">Reserved</Th>
              <Th className="w-24 text-right">Available</Th>
            </>
          }
        >
          {rows.map((row) => (
            <Tr key={row.key}>
              <Td className="font-medium">{row.warehouse}</Td>
              <Td className="text-muted-foreground">{row.product}</Td>
              <Td className="text-right tabular-nums">
                {formatNumber(row.onHand)}
              </Td>
              <Td className="text-right tabular-nums text-muted-foreground">
                {formatNumber(row.reserved)}
              </Td>
              <Td
                className={cn(
                  "text-right font-medium tabular-nums",
                  row.available === 0 && "text-red-600 dark:text-red-400",
                )}
              >
                {formatNumber(row.available)}
              </Td>
            </Tr>
          ))}

          {/* An empty filter result is not the same news as an empty warehouse,
              and saying "no stock on record" to someone who has just typed a
              product name reads as a data problem rather than a typo. */}
          {rows.length === 0 ? (
            <EmptyRow colSpan={5}>
              {stock.length === 0
                ? "No stock on record."
                : "No stock line matches these filters."}
            </EmptyRow>
          ) : null}
        </DataTable>
      </div>
    </Panel>
  );
}

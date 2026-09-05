import type { ReplenishmentRule, StockHealth } from "@/lib/business-logic";

/**
 * The shape of the stock grid, shared by the loader and the editor.
 *
 * Split out from `stock-server` for the same reason `quotations` is split from
 * `quotations-server`: the client component needs these types and `cellKey`,
 * and importing them from the loader's module would pull `server-only` into the
 * browser bundle and fail the build.
 */

export type StockCell = {
  warehouseId: string;
  productId: string;
  available: number;
  health: StockHealth;
  /** Null when nobody has written a reorder rule for this pair. */
  rule: ReplenishmentRule | null;
};

export type StockWarehouse = {
  id: string;
  name: string;
  code: string;
  active: boolean;
};

export type StockProduct = {
  id: string;
  name: string;
  sku: string | null;
  category: string;
};

export type ReorderSuggestion = {
  warehouseId: string;
  warehouseName: string;
  productId: string;
  productName: string;
  available: number;
  reorderPoint: number;
  orderQty: number;
  health: StockHealth;
  /** ISO date an order placed today would land. */
  arrivesOn: string;
};

export type StockBoard = {
  warehouses: StockWarehouse[];
  products: StockProduct[];
  /** `${warehouseId}:${productId}` → cell. Absent means nothing on hand. */
  cells: Record<string, StockCell>;
  reorders: ReorderSuggestion[];
  /** True when replenishment_rules is not in the database yet. */
  rulesMissing: boolean;
  error: string | null;
};

export const cellKey = (warehouseId: string, productId: string) =>
  `${warehouseId}:${productId}`;

import "server-only";
import {
  expectedArrival,
  stockHealth,
  suggestedOrderQty,
  type ReplenishmentRule,
} from "@/lib/business-logic";
import { isMissingTable } from "@/lib/schema-gap";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import {
  cellKey,
  type ReorderSuggestion,
  type StockBoard,
  type StockCell,
  type StockProduct,
  type StockWarehouse,
} from "@/lib/stock";

/**
 * A7 — what every warehouse is holding, and what needs bringing in.
 *
 * Stock and reorder rules are loaded together because neither is worth much
 * alone: a number with no reorder point is a figure nobody can act on, and a
 * reorder point with no stock beside it is a rule nobody can check. The health
 * band and the suggested order come from `business-logic`, so the editor and
 * any future scheduled job agree on what "low" means.
 */

export async function loadStockBoard(): Promise<StockBoard> {
  const supabase = createServerSupabaseClient();

  const [warehouses, products, stock, rules] = await Promise.all([
    supabase
      .from("warehouses")
      .select("id, name, code, active")
      .eq("active", true)
      .order("priority", { ascending: true })
      .returns<StockWarehouse[]>(),
    supabase
      .from("products")
      .select("id, name, sku, category")
      .eq("active", true)
      .order("category", { ascending: true })
      .order("name", { ascending: true })
      .returns<StockProduct[]>(),
    supabase
      .from("warehouse_stock")
      .select("warehouse_id, product_id, available")
      .returns<
        { warehouse_id: string; product_id: string; available: number }[]
      >(),
    supabase
      .from("replenishment_rules")
      .select(
        "warehouse_id, product_id, reorder_point, reorder_qty, lead_time_days",
      )
      .eq("active", true)
      .returns<
        {
          warehouse_id: string;
          product_id: string;
          reorder_point: number;
          reorder_qty: number;
          lead_time_days: number;
        }[]
      >(),
  ]);

  // A database created before replenishment_rules existed answers this with
  // "Could not find the table ... in the schema cache". That is a setup step
  // outstanding, not a failure of the page: stock on hand is most of what this
  // screen is for and it reads from a table that has always been there. So the
  // grid renders, the reorder panel says what to run, and the raw PostgREST
  // string never reaches the admin.
  const rulesMissing = isMissingTable(rules.error);

  const error =
    warehouses.error?.message ??
    products.error?.message ??
    stock.error?.message ??
    (rulesMissing ? null : (rules.error?.message ?? null));

  const ruleFor = new Map<string, ReplenishmentRule>(
    (rules.data ?? []).map((row) => [
      cellKey(row.warehouse_id, row.product_id),
      {
        reorderPoint: Number(row.reorder_point),
        reorderQty: Number(row.reorder_qty),
        leadTimeDays: Number(row.lead_time_days),
      },
    ]),
  );

  const warehouseRows = warehouses.data ?? [];
  const productRows = products.data ?? [];

  const onHand = new Map(
    (stock.data ?? []).map((row) => [
      cellKey(row.warehouse_id, row.product_id),
      Number(row.available),
    ]),
  );

  const cells: Record<string, StockCell> = {};
  const reorders: ReorderSuggestion[] = [];
  const now = new Date();

  // Walk the grid rather than the stock rows: a pair with a reorder rule and no
  // stock row at all is exactly the case worth surfacing, and iterating what
  // exists would skip it.
  for (const warehouse of warehouseRows) {
    for (const product of productRows) {
      const key = cellKey(warehouse.id, product.id);
      const rule = ruleFor.get(key) ?? null;
      const available = onHand.get(key) ?? 0;
      const health = stockHealth(available, rule);

      cells[key] = {
        warehouseId: warehouse.id,
        productId: product.id,
        available,
        health,
        rule,
      };

      if (!rule || health === "healthy") continue;

      const orderQty = suggestedOrderQty(available, rule);
      if (orderQty <= 0) continue;

      reorders.push({
        warehouseId: warehouse.id,
        warehouseName: warehouse.name,
        productId: product.id,
        productName: product.name,
        available,
        reorderPoint: rule.reorderPoint,
        orderQty,
        health,
        arrivesOn: expectedArrival(rule, now).toISOString().slice(0, 10),
      });
    }
  }

  // Emptiest first: an out-of-stock line is somebody unable to ship today, and
  // it should not sit below a line that merely touched its reorder point.
  reorders.sort((a, b) => a.available - b.available);

  return {
    warehouses: warehouseRows,
    products: productRows,
    cells,
    reorders,
    rulesMissing,
    error,
  };
}


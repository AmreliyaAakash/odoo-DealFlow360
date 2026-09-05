import { asCadence, monthlyValue, nextBillingDate } from "@/lib/business-logic";
import { formatDayMonth, isoDate, recentWeekStarts } from "@/lib/dates";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import {
  EMPTY_FINANCE_STATS,
  type FinanceStats,
  type MrrPoint,
  type QueueRow,
  type SplitStatus,
  type WarehouseStockRow,
} from "./types";

/** Quotes that are committed revenue for MRR and fulfilment purposes. */
const COMMITTED = ["approved", "won"];
/** Quotes still moving through the pipeline. */
const OPEN = ["draft", "pending_approval", "approved"];

/** Weeks of MRR history on the trend chart. */
const MRR_WEEKS = 8;

type QuotationRow = {
  id: string;
  reference: string | null;
  status: string | null;
  net_total: number | null;
  required_approvals: string[] | null;
  submitted_at: string | null;
  created_at: string | null;
  customers: { name: string | null } | null;
  quotation_lines:
    | {
        id: string;
        qty: number | null;
        unit_price: number | null;
        product_id: string;
        products: { name: string | null; cadence: string | null } | null;
      }[]
    | null;
};

type WarehouseRow = {
  id: string;
  name: string;
  code: string;
  region: string | null;
};

type StockRow = {
  warehouse_id: string;
  product_id: string;
  available: number | null;
};

type AllocationRow = {
  quotation_id: string;
  product_id: string;
  warehouse_id: string;
  qty: number | null;
};

export type FinanceDashboardData = {
  stats: FinanceStats;
  mrrTrend: MrrPoint[];
  warehouses: WarehouseStockRow[];
  queue: QueueRow[];
  loadError: string | null;
};

export async function loadFinanceDashboard(): Promise<FinanceDashboardData> {
  const supabase = createServerSupabaseClient();

  const [quotations, warehouses, stock, allocations] = await Promise.all([
    supabase
      .from("quotations")
      .select(
        `id, reference, status, net_total, required_approvals, submitted_at, created_at,
         customers(name),
         quotation_lines(id, qty, unit_price, product_id, products(name, cadence))`,
      )
      .order("created_at", { ascending: false })
      .limit(500)
      .returns<QuotationRow[]>(),
    supabase
      .from("warehouses")
      .select("id, name, code, region")
      .eq("active", true)
      .order("priority", { ascending: true })
      .returns<WarehouseRow[]>(),
    supabase
      .from("warehouse_stock")
      .select("warehouse_id, product_id, available")
      .returns<StockRow[]>(),
    supabase
      .from("quotation_allocations")
      .select("quotation_id, product_id, warehouse_id, qty")
      .returns<AllocationRow[]>(),
  ]);

  const error =
    quotations.error?.message ??
    warehouses.error?.message ??
    stock.error?.message ??
    allocations.error?.message;

  if (error) {
    return {
      stats: EMPTY_FINANCE_STATS,
      mrrTrend: emptyTrend(),
      warehouses: [],
      queue: [],
      loadError: error,
    };
  }

  const rows = quotations.data ?? [];
  const stockRows = stock.data ?? [];
  const allocationRows = allocations.data ?? [];

  const committed = rows.filter((row) => COMMITTED.includes(row.status ?? ""));
  const demand = buildDemand(rows.filter((row) => OPEN.includes(row.status ?? "")));
  const queue = buildQueue(rows, allocationRows);

  return {
    stats: {
      pendingFinanceApprovals: rows.filter(
        (row) =>
          row.status === "pending_approval" &&
          (row.required_approvals ?? []).includes("finance"),
      ).length,
      activeSubscriptions: committed.filter((row) => quotationMrr(row) > 0).length,
      backorderedItems: countBackordered(demand, stockRows),
      mrr: round(committed.reduce((sum, row) => sum + quotationMrr(row), 0)),
    },
    mrrTrend: buildMrrTrend(committed),
    warehouses: buildWarehouseStock(
      warehouses.data ?? [],
      stockRows,
      allocationRows,
      demand,
    ),
    queue,
    loadError: null,
  };
}

/* ------------------------------------------------------------------ *
 * MRR
 * ------------------------------------------------------------------ */

/** One quotation's recurring value, normalised to a month. */
function quotationMrr(row: QuotationRow): number {
  return (row.quotation_lines ?? []).reduce((sum, line) => {
    const cadence = asCadence(line.products?.cadence ?? null);
    if (cadence === "one_time") return sum;

    return (
      sum +
      monthlyValue({
        id: line.id,
        name: line.products?.name ?? "",
        cadence,
        qty: Number(line.qty ?? 0),
        unitPrice: Number(line.unit_price ?? 0),
      })
    );
  }, 0);
}

/**
 * MRR as it stood at the end of each of the last 8 weeks — a subscription counts
 * from the week it was committed onward, so the line is cumulative rather than
 * per-week new business.
 */
function buildMrrTrend(committed: QuotationRow[]): MrrPoint[] {
  const weeks = recentWeekStarts(MRR_WEEKS);

  return weeks.map((weekStart) => {
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const mrr = committed.reduce((sum, row) => {
      const started = row.submitted_at ?? row.created_at;
      if (!started) return sum;
      return new Date(started) < weekEnd ? sum + quotationMrr(row) : sum;
    }, 0);

    return {
      date: isoDate(weekStart),
      label: formatDayMonth(weekStart),
      mrr: round(mrr),
    };
  });
}

function emptyTrend(): MrrPoint[] {
  return buildMrrTrend([]);
}

/* ------------------------------------------------------------------ *
 * Stock and demand
 * ------------------------------------------------------------------ */

/** Units of each product committed to open quotations. */
function buildDemand(open: QuotationRow[]): Map<string, number> {
  const demand = new Map<string, number>();

  for (const row of open) {
    for (const line of row.quotation_lines ?? []) {
      demand.set(
        line.product_id,
        (demand.get(line.product_id) ?? 0) + Number(line.qty ?? 0),
      );
    }
  }

  return demand;
}

/** Products whose open demand exceeds total stock on hand. */
function countBackordered(
  demand: Map<string, number>,
  stock: StockRow[],
): number {
  const onHand = new Map<string, number>();
  for (const row of stock) {
    onHand.set(
      row.product_id,
      (onHand.get(row.product_id) ?? 0) + Number(row.available ?? 0),
    );
  }

  let backordered = 0;
  for (const [productId, wanted] of demand) {
    const have = onHand.get(productId) ?? 0;
    if (wanted > have) backordered += wanted - have;
  }

  return backordered;
}

function buildWarehouseStock(
  warehouses: WarehouseRow[],
  stock: StockRow[],
  allocations: AllocationRow[],
  demand: Map<string, number>,
): WarehouseStockRow[] {
  const onHand = new Map<string, number>();
  const shortages = new Map<string, number>();

  for (const row of stock) {
    const available = Number(row.available ?? 0);
    onHand.set(row.warehouse_id, (onHand.get(row.warehouse_id) ?? 0) + available);

    if ((demand.get(row.product_id) ?? 0) > available) {
      shortages.set(row.warehouse_id, (shortages.get(row.warehouse_id) ?? 0) + 1);
    }
  }

  const committed = new Map<string, number>();
  for (const row of allocations) {
    committed.set(
      row.warehouse_id,
      (committed.get(row.warehouse_id) ?? 0) + Number(row.qty ?? 0),
    );
  }

  const peak = Math.max(1, ...warehouses.map((w) => onHand.get(w.id) ?? 0));

  return warehouses.map((warehouse) => {
    const units = onHand.get(warehouse.id) ?? 0;

    return {
      warehouseId: warehouse.id,
      name: warehouse.name,
      code: warehouse.code,
      region: warehouse.region,
      onHand: units,
      committed: committed.get(warehouse.id) ?? 0,
      share: units / peak,
      shortages: shortages.get(warehouse.id) ?? 0,
    };
  });
}

/* ------------------------------------------------------------------ *
 * Fulfilment and billing queue
 * ------------------------------------------------------------------ */

function buildQueue(
  rows: QuotationRow[],
  allocations: AllocationRow[],
): QueueRow[] {
  const allocatedByQuote = new Map<string, number>();
  for (const allocation of allocations) {
    allocatedByQuote.set(
      allocation.quotation_id,
      (allocatedByQuote.get(allocation.quotation_id) ?? 0) + Number(allocation.qty ?? 0),
    );
  }

  return rows
    .filter((row) => COMMITTED.includes(row.status ?? ""))
    .map((row) => {
      const lines = row.quotation_lines ?? [];
      const orderedUnits = lines.reduce(
        (sum, line) => sum + Number(line.qty ?? 0),
        0,
      );
      const allocatedUnits = allocatedByQuote.get(row.id) ?? 0;
      const mrr = quotationMrr(row);

      return {
        id: row.id,
        reference: row.reference ?? row.id.slice(0, 10),
        customer: row.customers?.name ?? "Unassigned",
        kind: mrr > 0 ? ("subscription" as const) : ("one_time" as const),
        amount: Number(row.net_total ?? 0),
        mrr: round(mrr),
        splitStatus: splitStatus(orderedUnits, allocatedUnits),
        outstandingUnits: Math.max(orderedUnits - allocatedUnits, 0),
        nextBillDate: nextBillFor(row),
        status: row.status ?? "approved",
      };
    })
    .sort((a, b) => b.amount - a.amount);
}

function splitStatus(ordered: number, allocated: number): SplitStatus {
  if (ordered === 0) return "allocated";
  if (allocated === 0) return "unallocated";
  if (allocated >= ordered) return "allocated";
  // Partly allocated with nothing left to give reads as a backorder.
  return allocated / ordered < 0.5 ? "backordered" : "partial";
}

/** Earliest upcoming bill date across the quotation's recurring lines. */
function nextBillFor(row: QuotationRow): string | null {
  const anchor = row.submitted_at ?? row.created_at;
  if (!anchor) return null;

  const now = new Date();
  const dates = (row.quotation_lines ?? [])
    .map((line) => {
      const cadence = asCadence(line.products?.cadence ?? null);
      if (cadence === "one_time") return null;

      return nextBillingDate(
        {
          id: line.id,
          name: line.products?.name ?? "",
          cadence,
          qty: Number(line.qty ?? 0),
          unitPrice: Number(line.unit_price ?? 0),
          anchor,
        },
        now,
      );
    })
    .filter((date): date is Date => date !== null);

  if (dates.length === 0) return null;

  return new Date(Math.min(...dates.map((date) => date.getTime()))).toISOString();
}

/* ------------------------------------------------------------------ */

function round(value: number): number {
  return Math.round(value * 100) / 100;
}



import "server-only";
import {
  splitOrderAcrossWarehouses,
  type SplitLine,
  type WarehouseStock,
} from "@/lib/business-logic";
import { createServerSupabaseClient } from "@/lib/supabase-server";

/**
 * B6 — the allocation engine's data layer, shared by the page that renders the
 * split and the route that commits it.
 *
 * One module rather than two, because a suggestion the screen shows and a
 * suggestion the server saves have to be the same suggestion. If the page did
 * its own query the two would drift the first time either changed.
 *
 * Allocations are append-only commitments, not a draft that gets rewritten.
 * Each save takes whatever is still unallocated and commits it, drawing stock
 * down as it goes. That single rule covers three things the spec lists
 * separately: accepting the suggested split, overriding it by hand, and
 * consolidating a backorder — the last being nothing more than saving again
 * once stock has landed, since only the outstanding quantity is ever in play.
 */

export type SplitRequestLine = SplitLine;

export type SplitAllocation = {
  warehouseId: string;
  warehouseName: string;
  productId: string;
  productName: string;
  qty: number;
  /** True when a rep overrode the suggested allocation. */
  manual: boolean;
};

export type WarehouseSplitResponse = {
  /** Already committed against this quotation, from earlier saves. */
  committed: SplitAllocation[];
  /** What the engine proposes for the quantity still outstanding. */
  allocations: SplitAllocation[];
  /** Lines stock could not cover. */
  shortfalls: SplitRequestLine[];
  /** Parcels the proposed allocation would create. */
  shipmentCount: number;
  /** Summed shipping weight of the warehouses the proposal uses. */
  shippingCost: number;
  /** True once every ordered unit is committed. */
  fullyAllocated: boolean;
  /** Warehouses holding stock for this order, for the override picker. */
  warehouses: { id: string; name: string; code: string }[];
};

export type ManualAllocation = {
  warehouseId: string;
  productId: string;
  qty: number;
};

/** A quotation may only be allocated against once the deal is real. */
export const ALLOCATABLE_STATUSES = new Set(["approved", "won"]);

type Supabase = ReturnType<typeof createServerSupabaseClient>;

type StockRow = {
  warehouse_id: string;
  product_id: string;
  available: number;
  warehouses: {
    id: string;
    name: string;
    code: string;
    priority: number;
    shipping_cost_weight: number | null;
    active: boolean;
  } | null;
};

export type QuotationForSplit = {
  id: string;
  status: string | null;
  rep_id: string;
  quotation_lines: { product_id: string; qty: number }[];
};

/** The columns `buildSplit` needs off a quotation. */
export const SPLIT_QUOTATION_SELECT =
  "id, status, rep_id, quotation_lines(product_id, qty)";

/**
 * The whole picture for one quotation: what is committed, what the engine
 * proposes for the rest, and what is left on backorder.
 */
export async function buildSplit(
  supabase: Supabase,
  quotation: QuotationForSplit,
): Promise<WarehouseSplitResponse | { error: string }> {
  const ordered = collapse(
    quotation.quotation_lines.map((line) => ({
      productId: line.product_id,
      qty: Number(line.qty),
    })),
  );

  const context = await loadContext(supabase, quotation.id, ordered);
  if ("error" in context) return context;

  const proposal = suggest(subtract(ordered, context.committed), context.stock);

  return respond({ ...context, proposal, ordered });
}

/**
 * The same picture, loaded from scratch. For server components, which have a
 * quotation id and no reason to know how the split is assembled.
 */
export async function loadSplitForQuotation(
  quotationId: string,
): Promise<WarehouseSplitResponse | { error: string }> {
  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from("quotations")
    .select(SPLIT_QUOTATION_SELECT)
    .eq("id", quotationId)
    .maybeSingle<QuotationForSplit>();

  if (error) return { error: error.message };
  if (!data) return { error: "Quotation not found" };

  return buildSplit(supabase, data);
}

/**
 * Commit an allocation — the engine's own suggestion, or the rep's override of
 * it — and hand back the picture that follows.
 */
export async function commitSplit(
  supabase: Supabase,
  quotation: QuotationForSplit,
  manual: ManualAllocation[] | null,
): Promise<WarehouseSplitResponse | { error: string }> {
  const ordered = collapse(
    quotation.quotation_lines.map((line) => ({
      productId: line.product_id,
      qty: Number(line.qty),
    })),
  );

  const context = await loadContext(supabase, quotation.id, ordered);
  if ("error" in context) return context;

  const outstanding = subtract(ordered, context.committed);
  const proposal = manual
    ? validateManual(manual, outstanding, context.stock)
    : suggest(outstanding, context.stock);

  if ("error" in proposal) return proposal;

  if (proposal.allocations.length > 0) {
    const failure = await write(
      supabase,
      quotation.id,
      proposal.allocations,
      manual !== null,
      context.stock,
    );
    if (failure) return { error: failure };
  }

  // Re-read rather than patching the copy in memory, so what the screen shows
  // after a save is what the database actually holds.
  const after = await loadContext(supabase, quotation.id, ordered);
  if ("error" in after) return after;

  return respond({
    ...after,
    proposal: suggest(subtract(ordered, after.committed), after.stock),
    ordered,
  });
}

/* ------------------------------------------------------------------ *
 * Allocation maths
 * ------------------------------------------------------------------ */

type Proposal = {
  allocations: {
    warehouseId: string;
    warehouseName: string;
    productId: string;
    qty: number;
  }[];
  shortfalls: SplitLine[];
  shipmentCount: number;
  shippingCost: number;
};

function suggest(outstanding: SplitLine[], stock: WarehouseStock[]): Proposal {
  if (outstanding.length === 0) {
    return { allocations: [], shortfalls: [], shipmentCount: 0, shippingCost: 0 };
  }
  return splitOrderAcrossWarehouses(outstanding, stock);
}

/**
 * A rep's manual split, checked against the two things they cannot override:
 * the quantity still owed on the line, and the stock actually on the shelf.
 */
function validateManual(
  manual: ManualAllocation[],
  outstanding: SplitLine[],
  stock: WarehouseStock[],
): Proposal | { error: string } {
  const owed = new Map(outstanding.map((line) => [line.productId, line.qty]));
  const shelf = new Map(
    stock.map((row) => [`${row.warehouseId}:${row.productId}`, row.available]),
  );
  const names = new Map(stock.map((row) => [row.warehouseId, row.warehouseName]));

  const taken = new Map<string, number>();
  const allocations: Proposal["allocations"] = [];

  for (const entry of manual) {
    if (entry.qty <= 0) continue;

    const name = names.get(entry.warehouseId);
    if (!name) {
      return { error: "One of the chosen warehouses has no stock on record" };
    }

    const key = `${entry.warehouseId}:${entry.productId}`;
    const available = shelf.get(key) ?? 0;
    const already = taken.get(key) ?? 0;
    if (already + entry.qty > available) {
      return { error: `${name} only has ${available} of that product available` };
    }

    const remaining = owed.get(entry.productId) ?? 0;
    if (entry.qty > remaining) {
      return {
        error:
          remaining === 0
            ? "That product is already fully allocated"
            : `Only ${remaining} unit(s) of that product are still to allocate`,
      };
    }

    owed.set(entry.productId, remaining - entry.qty);
    taken.set(key, already + entry.qty);
    allocations.push({
      warehouseId: entry.warehouseId,
      warehouseName: name,
      productId: entry.productId,
      qty: entry.qty,
    });
  }

  const sites = new Set(allocations.map((row) => row.warehouseId));
  const weights = new Map(
    stock.map((row) => [row.warehouseId, row.shippingCostWeight ?? 1]),
  );

  return {
    allocations,
    shortfalls: [...owed]
      .filter(([, qty]) => qty > 0)
      .map(([productId, qty]) => ({ productId, qty })),
    shipmentCount: sites.size,
    shippingCost: round2(
      [...sites].reduce((sum, id) => sum + (weights.get(id) ?? 1), 0),
    ),
  };
}

/**
 * Write the allocation and draw the stock down in the same breath.
 *
 * Not a transaction: PostgREST has no multi-statement call, and a stored
 * procedure is machinery this project does not otherwise need. The order is what
 * carries the safety instead — stock is decremented first, so the worst case is
 * stock reserved without a visible allocation row, which reads as a discrepancy
 * and can be corrected, rather than an allocation promising units nobody set aside.
 */
async function write(
  supabase: Supabase,
  quotationId: string,
  allocations: Proposal["allocations"],
  manual: boolean,
  stock: WarehouseStock[],
): Promise<string | null> {
  const available = new Map(
    stock.map((row) => [`${row.warehouseId}:${row.productId}`, row.available]),
  );

  for (const row of allocations) {
    const key = `${row.warehouseId}:${row.productId}`;
    const left = Math.max(0, (available.get(key) ?? 0) - row.qty);

    const { error } = await supabase
      .from("warehouse_stock")
      .update({ available: left, updated_at: new Date().toISOString() })
      .eq("warehouse_id", row.warehouseId)
      .eq("product_id", row.productId);

    if (error) return error.message;
    available.set(key, left);
  }

  const { error } = await supabase.from("quotation_allocations").insert(
    allocations.map((row) => ({
      quotation_id: quotationId,
      product_id: row.productId,
      warehouse_id: row.warehouseId,
      qty: row.qty,
      manual,
    })),
  );

  return error?.message ?? null;
}

/* ------------------------------------------------------------------ *
 * Loading
 * ------------------------------------------------------------------ */

type Context = {
  stock: WarehouseStock[];
  committed: SplitAllocation[];
  productNames: Map<string, string>;
  warehouses: { id: string; name: string; code: string }[];
};

/** A UUID that matches nothing, so an empty `in()` filter stays valid SQL. */
const NO_MATCH = "00000000-0000-0000-0000-000000000000";

async function loadContext(
  supabase: Supabase,
  quotationId: string,
  ordered: SplitLine[],
): Promise<Context | { error: string }> {
  const productIds =
    ordered.length > 0 ? ordered.map((line) => line.productId) : [NO_MATCH];

  const [stockResult, allocationResult, productResult] = await Promise.all([
    supabase
      .from("warehouse_stock")
      .select(
        `warehouse_id, product_id, available,
         warehouses(id, name, code, priority, shipping_cost_weight, active)`,
      )
      .in("product_id", productIds)
      .returns<StockRow[]>(),
    supabase
      .from("quotation_allocations")
      .select("warehouse_id, product_id, qty, manual, warehouses(name)")
      .eq("quotation_id", quotationId)
      .returns<
        {
          warehouse_id: string;
          product_id: string;
          qty: number;
          manual: boolean;
          warehouses: { name: string | null } | null;
        }[]
      >(),
    supabase
      .from("products")
      .select("id, name")
      .in("id", productIds)
      .returns<{ id: string; name: string }[]>(),
  ]);

  const failure = stockResult.error ?? allocationResult.error ?? productResult.error;
  if (failure) return { error: failure.message };

  const productNames = new Map(
    (productResult.data ?? []).map((row) => [row.id, row.name]),
  );

  // An inactive warehouse keeps its history but takes no new allocations.
  const rows = (stockResult.data ?? []).filter((row) => row.warehouses?.active);

  const stock: WarehouseStock[] = rows.map((row) => ({
    warehouseId: row.warehouse_id,
    warehouseName: row.warehouses?.name ?? "Unknown warehouse",
    productId: row.product_id,
    available: Number(row.available),
    priority: Number(row.warehouses?.priority ?? 100),
    shippingCostWeight:
      row.warehouses?.shipping_cost_weight == null
        ? undefined
        : Number(row.warehouses.shipping_cost_weight),
  }));

  const warehouses = [
    ...new Map(
      rows.map((row) => [
        row.warehouse_id,
        {
          id: row.warehouse_id,
          name: row.warehouses?.name ?? "Unknown warehouse",
          code: row.warehouses?.code ?? "",
        },
      ]),
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name));

  const committed: SplitAllocation[] = (allocationResult.data ?? []).map((row) => ({
    warehouseId: row.warehouse_id,
    warehouseName: row.warehouses?.name ?? "Unknown warehouse",
    productId: row.product_id,
    productName: productNames.get(row.product_id) ?? "Unknown product",
    qty: Number(row.qty),
    manual: row.manual,
  }));

  return { stock, committed, productNames, warehouses };
}

/* ------------------------------------------------------------------ *
 * Shaping
 * ------------------------------------------------------------------ */

function respond(input: {
  committed: SplitAllocation[];
  proposal: Proposal;
  productNames: Map<string, string>;
  warehouses: { id: string; name: string; code: string }[];
  ordered: SplitLine[];
}): WarehouseSplitResponse {
  const { committed, proposal, productNames, warehouses, ordered } = input;

  const allocatedTotal = committed.reduce((sum, row) => sum + row.qty, 0);
  const orderedTotal = ordered.reduce((sum, line) => sum + line.qty, 0);

  return {
    committed,
    allocations: proposal.allocations.map((row) => ({
      ...row,
      productName: productNames.get(row.productId) ?? "Unknown product",
      manual: false,
    })),
    shortfalls: proposal.shortfalls,
    shipmentCount: proposal.shipmentCount,
    shippingCost: proposal.shippingCost,
    fullyAllocated: orderedTotal > 0 && allocatedTotal >= orderedTotal,
    warehouses,
  };
}

/** One entry per product, so the same product on two lines is allocated once. */
function collapse(lines: SplitLine[]): SplitLine[] {
  const totals = new Map<string, number>();
  for (const line of lines) {
    if (!(line.qty > 0)) continue;
    totals.set(line.productId, (totals.get(line.productId) ?? 0) + line.qty);
  }
  return [...totals].map(([productId, qty]) => ({ productId, qty }));
}

/** Ordered quantities less what has already been committed. */
function subtract(ordered: SplitLine[], committed: SplitAllocation[]): SplitLine[] {
  const allocated = new Map<string, number>();
  for (const row of committed) {
    allocated.set(row.productId, (allocated.get(row.productId) ?? 0) + row.qty);
  }

  return ordered
    .map((line) => ({
      productId: line.productId,
      qty: line.qty - (allocated.get(line.productId) ?? 0),
    }))
    .filter((line) => line.qty > 0);
}

export function parseManualAllocations(
  value: unknown,
): ManualAllocation[] | null | "invalid" {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) return "invalid";

  const parsed: ManualAllocation[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) return "invalid";

    const { warehouseId, productId, qty } = entry as Record<string, unknown>;
    if (typeof warehouseId !== "string" || typeof productId !== "string") {
      return "invalid";
    }
    if (typeof qty !== "number" || !Number.isFinite(qty) || qty < 0) {
      return "invalid";
    }

    parsed.push({ warehouseId, productId, qty });
  }

  return parsed;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

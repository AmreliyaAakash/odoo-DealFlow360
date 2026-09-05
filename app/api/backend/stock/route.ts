import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase-server";

/**
 * A5 — setting what a warehouse holds.
 *
 * Separate from the generic `/api/backend/[entity]` handler because
 * `warehouse_stock` is not shaped like the config tables: it has no surrogate
 * id and no active flag, it is keyed by a pair, and a save is a batch of cells
 * rather than one row. Bending the generic handler around that would have cost
 * more than the ninety lines here.
 *
 * Writes are upserts on the composite key, so setting a figure for a pair that
 * has never had a stock row works the same as changing one that has — the
 * editor shows a zero for both, and the admin should not have to know which is
 * which.
 */

const MAX_CELLS = 500;

type Cell = { warehouseId: string; productId: string; available: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseCells(payload: unknown): Cell[] | { error: string } {
  if (typeof payload !== "object" || payload === null) {
    return { error: "Body must be an object" };
  }

  const cells = (payload as { cells?: unknown }).cells;
  if (!Array.isArray(cells)) return { error: "cells must be an array" };
  if (cells.length === 0) return { error: "Nothing to save" };
  if (cells.length > MAX_CELLS) {
    return { error: `At most ${MAX_CELLS} cells can be saved at once` };
  }

  const parsed: Cell[] = [];
  const seen = new Set<string>();

  for (const raw of cells) {
    if (typeof raw !== "object" || raw === null) {
      return { error: "Each cell must be an object" };
    }

    const { warehouseId, productId, available } = raw as Record<string, unknown>;

    if (typeof warehouseId !== "string" || !UUID.test(warehouseId)) {
      return { error: "Each cell needs a valid warehouseId" };
    }
    if (typeof productId !== "string" || !UUID.test(productId)) {
      return { error: "Each cell needs a valid productId" };
    }

    const qty = typeof available === "number" ? available : Number(available);
    if (!Number.isInteger(qty) || qty < 0) {
      return { error: "Stock must be a whole number, zero or more" };
    }

    // A duplicated pair in one request has no defined winner. Rejecting it is
    // better than silently applying whichever the database happened to see
    // last, which would make the saved figure depend on array order.
    const key = `${warehouseId}:${productId}`;
    if (seen.has(key)) {
      return { error: "The same warehouse and product appears twice" };
    }
    seen.add(key);

    parsed.push({ warehouseId, productId, available: qty });
  }

  return parsed;
}

export async function PATCH(request: Request) {
  const authorized = await requireCapability("warehouses", "write");
  if (!authorized.ok) return authorized.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = parseCells(payload);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const supabase = createServerSupabaseClient();

  // Read what is there now, so the audit trail can say what each figure moved
  // from — and so a cell submitted at its current value is not logged as a
  // change nobody made.
  const { data: existing, error: readError } = await supabase
    .from("warehouse_stock")
    .select("warehouse_id, product_id, available")
    .in("warehouse_id", [...new Set(parsed.map((cell) => cell.warehouseId))])
    .returns<{ warehouse_id: string; product_id: string; available: number }[]>();

  if (readError) {
    return NextResponse.json({ error: readError.message }, { status: 500 });
  }

  const before = new Map(
    (existing ?? []).map((row) => [
      `${row.warehouse_id}:${row.product_id}`,
      Number(row.available),
    ]),
  );

  const changed = parsed.filter(
    (cell) =>
      (before.get(`${cell.warehouseId}:${cell.productId}`) ?? 0) !== cell.available,
  );

  if (changed.length === 0) {
    return NextResponse.json({ updated: 0 });
  }

  const { error } = await supabase.from("warehouse_stock").upsert(
    changed.map((cell) => ({
      warehouse_id: cell.warehouseId,
      product_id: cell.productId,
      available: cell.available,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: "warehouse_id,product_id" },
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // One audit line per cell. The trail is a record, not a gate: a failure here
  // must not undo a write that already succeeded.
  await supabase.from("config_audit_log").insert(
    changed.map((cell) => ({
      actor_id: authorized.actor.userId,
      entity: "warehouse_stock",
      entity_id: `${cell.warehouseId}:${cell.productId}`,
      entity_label: null,
      action: "update",
      field: "available",
      old_value: String(before.get(`${cell.warehouseId}:${cell.productId}`) ?? 0),
      new_value: String(cell.available),
    })),
  );

  return NextResponse.json({ updated: changed.length });
}

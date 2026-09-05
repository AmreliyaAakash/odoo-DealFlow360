import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import {
  ALLOCATABLE_STATUSES,
  buildSplit,
  commitSplit,
  parseManualAllocations,
  SPLIT_QUOTATION_SELECT,
  type QuotationForSplit,
} from "@/lib/warehouse-split-server";

/**
 * B6 — warehouse allocation.
 *
 * Auth and shape only; the allocation itself lives in `warehouse-split-server`
 * so the quotation page can render the same split without going through HTTP.
 *
 * `save: false` (the default) is a read — recalculating after stock has moved.
 * `save: true` commits, and is checked against `write` separately, so a manager
 * can see the suggested split and still be refused the button that accepts it.
 */

export type {
  SplitAllocation,
  SplitRequestLine,
  WarehouseSplitResponse,
} from "@/lib/warehouse-split-server";

export async function POST(request: Request) {
  const authorized = await requireCapability("warehouseSplit", "view");
  if (!authorized.ok) return authorized.response;

  const { actor } = authorized;

  let payload: { quotationId?: unknown; save?: unknown; allocations?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const quotationId =
    typeof payload.quotationId === "string" ? payload.quotationId : null;
  if (!quotationId) {
    return NextResponse.json({ error: "quotationId is required" }, { status: 400 });
  }

  const save = payload.save === true;
  const manual = parseManualAllocations(payload.allocations);
  if (manual === "invalid") {
    return NextResponse.json(
      { error: "allocations must be {warehouseId, productId, qty} objects" },
      { status: 400 },
    );
  }

  if (save) {
    const canCommit = await requireCapability("warehouseSplit", "write");
    if (!canCommit.ok) return canCommit.response;
  }

  const supabase = createServerSupabaseClient();

  const { data: quotation, error } = await supabase
    .from("quotations")
    .select(SPLIT_QUOTATION_SELECT)
    .eq("id", quotationId)
    .maybeSingle<QuotationForSplit>();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!quotation) {
    return NextResponse.json({ error: "Quotation not found" }, { status: 404 });
  }

  // A rep allocates their own quotations and no one else's, the same rule the
  // builder applies. RLS narrows it too; checking here turns a silent no-op into
  // an honest 403.
  if (actor.scope === "own" && quotation.rep_id !== actor.userId) {
    return NextResponse.json(
      { error: "This quotation belongs to another rep" },
      { status: 403 },
    );
  }
  if (save && !ALLOCATABLE_STATUSES.has(quotation.status ?? "")) {
    return NextResponse.json(
      { error: `A quotation with status "${quotation.status}" cannot be allocated yet` },
      { status: 409 },
    );
  }

  const result = save
    ? await commitSplit(supabase, quotation, manual)
    : await buildSplit(supabase, quotation);

  if ("error" in result) {
    // A manual split that fails validation is the caller's mistake, not ours.
    return NextResponse.json({ error: result.error }, { status: save ? 400 : 500 });
  }

  return NextResponse.json(result);
}

import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/**
 * STRUCTURE ONLY — allocation engine not implemented.
 *
 * Note: step B6 described this route as already existing; it did not, so this
 * stub defines the contract `WarehouseSplitView` consumes.
 */

export type SplitRequestLine = {
  productId: string;
  qty: number;
};

export type SplitAllocation = {
  warehouseId: string;
  warehouseName: string;
  productId: string;
  qty: number;
  /** True when a rep overrode the suggested allocation. */
  manual: boolean;
};

export type WarehouseSplitResponse = {
  allocations: SplitAllocation[];
  /** Lines that could not be fully allocated from stock. */
  shortfalls: SplitRequestLine[];
};

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // TODO(B6): allocate each line across warehouses by stock, proximity and cost.
  const response: WarehouseSplitResponse = { allocations: [], shortfalls: [] };

  return NextResponse.json(response);
}

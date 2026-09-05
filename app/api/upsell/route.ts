import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";
import { LINES_SHAPE_ERROR, parseLines } from "@/lib/quotations-server";
import { suggestUpsells } from "@/lib/upsell-server";

/**
 * B5 — upsell and cross-sell suggestions for a cart.
 *
 * POST rather than GET because the suggestion depends on the whole quotation,
 * not one product: the margin delta shown against each row is the change to the
 * quotation's blended margin, which cannot be computed from a product id alone.
 *
 * GET stays for the standalone browser, where "the cart" is one product.
 */

export type { UpsellSuggestion } from "@/lib/business-logic";

export async function POST(request: Request) {
  const authorized = await requireCapability("upsellPanel", "use");
  if (!authorized.ok) return authorized.response;

  let payload: { lines?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const lines = parseLines(payload.lines);
  if (!lines) {
    return NextResponse.json({ error: LINES_SHAPE_ERROR }, { status: 400 });
  }

  const suggestions = await suggestUpsells(lines);
  if ("error" in suggestions) {
    return NextResponse.json({ error: suggestions.error }, { status: 500 });
  }

  return NextResponse.json({ suggestions });
}

export async function GET(request: Request) {
  const authorized = await requireCapability("upsellPanel", "use");
  if (!authorized.ok) return authorized.response;

  const productId = new URL(request.url).searchParams.get("productId");
  if (!productId) {
    return NextResponse.json({ error: "productId is required" }, { status: 400 });
  }

  const suggestions = await suggestUpsells([
    { productId, qty: 1, discountPct: 0 },
  ]);
  if ("error" in suggestions) {
    return NextResponse.json({ error: suggestions.error }, { status: 500 });
  }

  return NextResponse.json({ productId, suggestions });
}

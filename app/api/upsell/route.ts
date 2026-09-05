import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";

/** STRUCTURE ONLY — suggestion engine not implemented. */

export type UpsellSuggestion = {
  productId: string;
  name: string;
  category: string;
  listPrice: number;
  /** Change in blended margin (as a fraction) if this product is added. */
  marginDelta: number;
  reason: string;
};

export async function GET(request: Request) {
  const authorized = await requireCapability("upsellPanel", "use");
  if (!authorized.ok) return authorized.response;

  const productId = new URL(request.url).searchParams.get("productId");
  if (!productId) {
    return NextResponse.json({ error: "productId is required" }, { status: 400 });
  }

  // TODO(B5): look up complementary products for `productId` and score each by
  // margin impact against the current quotation.
  const suggestions: UpsellSuggestion[] = [];

  return NextResponse.json({ productId, suggestions });
}

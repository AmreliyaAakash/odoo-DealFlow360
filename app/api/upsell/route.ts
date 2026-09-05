import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

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
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const productId = new URL(request.url).searchParams.get("productId");
  if (!productId) {
    return NextResponse.json({ error: "productId is required" }, { status: 400 });
  }

  // TODO(B5): look up complementary products for `productId` and score each by
  // margin impact against the current quotation.
  const suggestions: UpsellSuggestion[] = [];

  return NextResponse.json({ productId, suggestions });
}

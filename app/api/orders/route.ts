import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";
import { createOrderFromQuotation } from "@/lib/billing-server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

/**
 * B7 — raise an order from a confirmed quotation.
 *
 * Deliberately explicit rather than a side effect of confirming: fulfilment and
 * billing are finance's to start, and a quotation that is won but not yet
 * ordered is a real state a desk needs to be able to see.
 */

export async function GET() {
  const authorized = await requireCapability("billing", "view");
  if (!authorized.ok) return authorized.response;

  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from("orders")
    .select(
      `id, reference, status, created_at,
       quotations(id, reference, net_total),
       customers(name),
       invoices(id, kind, total, amount_paid, status, due_date)`,
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ orders: data ?? [] });
}

export async function POST(request: Request) {
  const authorized = await requireCapability("billing", "write");
  if (!authorized.ok) return authorized.response;

  let payload: { quotationId?: unknown };
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

  const supabase = createServerSupabaseClient();
  const result = await createOrderFromQuotation(
    supabase,
    quotationId,
    authorized.actor.userId,
  );

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result, { status: 201 });
}

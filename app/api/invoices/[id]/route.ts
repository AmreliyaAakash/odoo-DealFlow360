import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";
import { changeSubscription, recordPayment } from "@/lib/billing-server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

/**
 * B7 — acting on one invoice.
 *
 * Two actions on one route because they are the same conversation about the same
 * document: money came in, or the thing being billed for changed. Both leave the
 * issued invoice standing and record what happened alongside it.
 */

const METHODS = ["bank_transfer", "card", "cheque", "cash", "other"] as const;

export async function GET(_request: Request, ctx: RouteContext<"/api/invoices/[id]">) {
  const authorized = await requireCapability("billing", "view");
  if (!authorized.ok) return authorized.response;

  const { id } = await ctx.params;
  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from("invoices")
    .select(
      `id, reference, kind, period_start, period_end, due_date, total,
       amount_paid, status, issued_at,
       invoice_lines(id, description, qty, unit_price, amount),
       payments(id, amount, method, reference, recorded_at)`,
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}

export async function POST(request: Request, ctx: RouteContext<"/api/invoices/[id]">) {
  const authorized = await requireCapability("billing", "write");
  if (!authorized.ok) return authorized.response;

  const { id } = await ctx.params;

  let payload: {
    action?: unknown;
    amount?: unknown;
    method?: unknown;
    reference?: unknown;
    qty?: unknown;
  };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const supabase = createServerSupabaseClient();

  if (payload.action === "change_quantity") {
    const qty = typeof payload.qty === "number" ? payload.qty : Number(payload.qty);
    if (!Number.isFinite(qty) || qty < 0) {
      return NextResponse.json(
        { error: "qty must be zero or more — zero cancels the subscription" },
        { status: 400 },
      );
    }

    const result = await changeSubscription(
      supabase,
      id,
      qty,
      authorized.actor.userId,
      qty === 0 ? "cancellation" : "downgrade",
    );

    return "error" in result
      ? NextResponse.json({ error: result.error }, { status: result.status })
      : NextResponse.json(result);
  }

  // Anything else on this route is a payment; `action` is optional for it
  // because recording money is what the endpoint is mostly for.
  const amount =
    typeof payload.amount === "number" ? payload.amount : Number(payload.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      { error: "amount must be greater than zero" },
      { status: 400 },
    );
  }

  const method =
    typeof payload.method === "string" &&
    (METHODS as readonly string[]).includes(payload.method)
      ? payload.method
      : "bank_transfer";

  const reference =
    typeof payload.reference === "string" && payload.reference.trim().length > 0
      ? payload.reference.trim()
      : null;

  const result = await recordPayment(
    supabase,
    id,
    amount,
    method,
    reference,
    authorized.actor.userId,
  );

  return "error" in result
    ? NextResponse.json({ error: result.error }, { status: result.status })
    : NextResponse.json(result);
}

import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";
import {
  canTransitionSubscription,
  SUBSCRIPTION_STATUSES,
  type SubscriptionStatus,
} from "@/lib/business-logic";
import { createServerSupabaseClient } from "@/lib/supabase-server";

/**
 * B7 — pause, resume or cancel one subscription.
 *
 * The legal moves live in `business-logic`, so the button that is offered and
 * the change that is allowed cannot drift apart. Cancellation is terminal by
 * design: a returning customer gets a fresh subscription with its own start
 * date rather than a revived one with an unexplained gap in its billing.
 */

type Row = { id: string; status: SubscriptionStatus; next_bill_on: string | null };

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/subscriptions/[id]">,
) {
  const authorized = await requireCapability("billing", "write");
  if (!authorized.ok) return authorized.response;

  const { id } = await ctx.params;

  let payload: { status?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const next = payload.status;
  if (!isStatus(next)) {
    return NextResponse.json(
      { error: `status must be one of: ${SUBSCRIPTION_STATUSES.join(", ")}` },
      { status: 400 },
    );
  }

  const supabase = createServerSupabaseClient();

  const { data: existing, error: loadError } = await supabase
    .from("subscriptions")
    .select("id, status, next_bill_on")
    .eq("id", id)
    .maybeSingle<Row>();

  if (loadError) {
    return NextResponse.json({ error: loadError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
  }

  if (existing.status === next) {
    return NextResponse.json({ id, status: next, changed: false });
  }
  if (!canTransitionSubscription(existing.status, next)) {
    return NextResponse.json(
      {
        error:
          existing.status === "cancelled"
            ? "A cancelled subscription cannot be restarted. Raise a new one instead."
            : `A ${existing.status} subscription cannot move to ${next}`,
      },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();

  const { error } = await supabase
    .from("subscriptions")
    .update({
      status: next,
      updated_at: now,
      paused_at: next === "paused" ? now : null,
      cancelled_at: next === "cancelled" ? now : null,
      // A paused or cancelled subscription has no next bill date. Clearing it
      // rather than leaving it stale is what keeps the billing run honest —
      // a date in the future on a paused plan is an invoice waiting to happen.
      next_bill_on: next === "active" ? existing.next_bill_on : null,
    })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ id, status: next, changed: true });
}

function isStatus(value: unknown): value is SubscriptionStatus {
  return (
    typeof value === "string" &&
    (SUBSCRIPTION_STATUSES as readonly string[]).includes(value)
  );
}

import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";
import { isQuoteClosedLost } from "@/lib/business-logic";
import type { QuotationLineInput } from "@/lib/quotations";
import {
  priceLines,
  replaceQuotationLines,
  summaryColumns,
} from "@/lib/quotations-server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

/**
 * B8 — the two things a customer can do to their own quotation.
 *
 * `counter` is what makes this a living document rather than a PDF with a
 * comment box: the requested discount is applied to the lines, the quotation is
 * re-priced from the catalog, and the approval routing runs again on the result.
 * If the new terms still clear the desk's thresholds the quote comes back
 * approved on its own; if they do not, it re-enters the approval chain
 * automatically — which is the point, and is why the rep never has to remember
 * to resubmit it.
 *
 * `confirm` accepts the terms as they stand. Only an approved quotation can be
 * confirmed, so a customer can never close a deal the desk has not cleared.
 */

const ACTIONS = ["counter", "confirm"] as const;
type Action = (typeof ACTIONS)[number];

type Supabase = ReturnType<typeof createServerSupabaseClient>;

type QuotationRow = {
  id: string;
  status: string | null;
  customer_id: string | null;
  max_discount_pct: number | null;
  quotation_lines: {
    product_id: string;
    qty: number;
    unit_price: number;
    subscription_plan_id: string | null;
  }[];
};

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/quotations/[id]/portal-action">,
) {
  const authorized = await requireCapability("customerPortal", "write");
  if (!authorized.ok) return authorized.response;

  const { actor } = authorized;
  const { id } = await ctx.params;

  let payload: { action?: unknown; discountPct?: unknown; note?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isAction(payload.action)) {
    return NextResponse.json(
      { error: `action must be one of: ${ACTIONS.join(", ")}` },
      { status: 400 },
    );
  }

  const supabase = createServerSupabaseClient();

  const { data: quotation, error: loadError } = await supabase
    .from("quotations")
    .select(
      `id, status, customer_id, max_discount_pct,
       quotation_lines(product_id, qty, unit_price, subscription_plan_id)`,
    )
    .eq("id", id)
    .maybeSingle<QuotationRow>();

  if (loadError) {
    return NextResponse.json({ error: loadError.message }, { status: 500 });
  }
  // RLS already limits a portal user to their own customer's quotations, so a
  // miss here is either a bad id or somebody else's quote. Both answer 404:
  // telling them apart would reveal which ids exist.
  if (!quotation) {
    return NextResponse.json({ error: "Quotation not found" }, { status: 404 });
  }

  // A customer acting through the portal must own the quote. Staff who reach
  // this endpoint have already passed the capability check and are acting on the
  // customer's behalf, which is why the ownership test is scoped to the role.
  if (actor.role === "customer") {
    const owns = await ownsQuotation(supabase, actor.userId, quotation.customer_id);
    if (!owns) {
      return NextResponse.json({ error: "Quotation not found" }, { status: 404 });
    }
  }

  if (isQuoteClosedLost(quotation.status)) {
    return NextResponse.json({ error: "This quotation is closed" }, { status: 409 });
  }

  return payload.action === "confirm"
    ? confirm(supabase, quotation, actor.userId)
    : counter(supabase, quotation, actor.userId, payload.discountPct, payload.note);
}

/* ------------------------------------------------------------------ *
 * Counter
 * ------------------------------------------------------------------ */

/**
 * Apply the customer's counter and re-run the routing.
 *
 * The discount lands on every line rather than one, because an order-level ask
 * is what the customer actually made — they countered the deal, not a SKU. Unit
 * prices stay as quoted, so a counter moves the discount and nothing else, and
 * cost still comes from the catalog: the margin erosion the counter causes shows
 * up honestly and is what the routing sees.
 */
async function counter(
  supabase: Supabase,
  quotation: QuotationRow,
  actorId: string,
  requested: unknown,
  note: unknown,
) {
  const discountPct = typeof requested === "number" ? requested : Number(requested);

  if (!Number.isFinite(discountPct) || discountPct < 0 || discountPct > 100) {
    return NextResponse.json(
      { error: "discountPct must be between 0 and 100" },
      { status: 400 },
    );
  }

  const current = Number(quotation.max_discount_pct ?? 0);
  if (discountPct <= current) {
    return NextResponse.json(
      {
        error: `You are already being offered ${current}%. Ask for more than that, or confirm the quote as it stands.`,
      },
      { status: 400 },
    );
  }

  if (quotation.quotation_lines.length === 0) {
    return NextResponse.json(
      { error: "This quotation has no lines to re-price" },
      { status: 409 },
    );
  }

  const lines: QuotationLineInput[] = quotation.quotation_lines.map((line) => ({
    productId: line.product_id,
    qty: Number(line.qty),
    discountPct,
    unitPrice: Number(line.unit_price),
    subscriptionPlanId: line.subscription_plan_id,
  }));

  const priced = await priceLines(supabase, lines);
  if (!priced.ok) {
    return NextResponse.json({ error: priced.error }, { status: priced.status });
  }

  const linesError = await replaceQuotationLines(
    supabase,
    quotation.id,
    lines,
    priced.productsById,
  );
  if (linesError) {
    return NextResponse.json({ error: linesError.error }, { status: 500 });
  }

  const needsApproval = priced.approvals.length > 0;

  // A fresh round. Earlier decisions were made about different terms, and
  // leaving them standing would let a manager's approval carry a discount they
  // never saw. The approval rows themselves are kept — the audit trail is the
  // point — but the queue reads the round off `submitted_at`, so moving it is
  // what reopens the deal.
  const { error: updateError } = await supabase
    .from("quotations")
    .update({
      ...summaryColumns(priced.summary, priced.approvals),
      status: needsApproval ? "pending_approval" : "approved",
      submitted_by: actorId,
      submitted_at: new Date().toISOString(),
    })
    .eq("id", quotation.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  // The counter is part of the conversation too, so it lands in the thread the
  // rep is already reading rather than only in the numbers.
  const trailing =
    typeof note === "string" && note.trim().length > 0 ? ` — ${note.trim()}` : "";

  await supabase.from("negotiation_messages").insert({
    quotation_id: quotation.id,
    author_id: actorId,
    author_kind: "customer",
    body: `Counter-proposal: ${discountPct}% across the quotation${trailing}`,
  });

  return NextResponse.json({
    action: "counter",
    status: needsApproval ? "pending_approval" : "approved",
    reEnteredApproval: needsApproval,
    requiredApprovals: [
      ...new Set(priced.approvals.map((approval) => approval.level)),
    ],
    netTotal: priced.summary.net,
  });
}

/* ------------------------------------------------------------------ *
 * Confirm
 * ------------------------------------------------------------------ */

/** Accept the terms as they stand. Approved quotations only. */
async function confirm(supabase: Supabase, quotation: QuotationRow, actorId: string) {
  if (quotation.status !== "approved") {
    return NextResponse.json(
      {
        error:
          quotation.status === "pending_approval"
            ? "This quotation is still with our approvals desk. You can confirm it once it clears."
            : `A quotation with status "${quotation.status}" cannot be confirmed`,
      },
      { status: 409 },
    );
  }

  const { error } = await supabase
    .from("quotations")
    .update({ status: "won" })
    .eq("id", quotation.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await supabase.from("negotiation_messages").insert({
    quotation_id: quotation.id,
    author_id: actorId,
    author_kind: "customer",
    body: "Quotation confirmed. Please proceed to fulfilment.",
  });

  return NextResponse.json({ action: "confirm", status: "won" });
}

/** Whether this portal user is the contact on the quotation's customer. */
async function ownsQuotation(
  supabase: Supabase,
  userId: string,
  customerId: string | null,
): Promise<boolean> {
  if (!customerId) return false;

  const { data } = await supabase
    .from("customers")
    .select("id")
    .eq("portal_user_id", userId)
    .maybeSingle<{ id: string }>();

  return data?.id === customerId;
}

function isAction(value: unknown): value is Action {
  return typeof value === "string" && (ACTIONS as readonly string[]).includes(value);
}

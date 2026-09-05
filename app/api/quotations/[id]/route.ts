import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { RequiredApproval } from "@/lib/business-logic";
import {
  LINES_SHAPE_ERROR,
  parseLines,
  priceLines,
  replaceQuotationLines,
  summaryColumns,
} from "@/lib/quotations-server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

const QUOTATION_SELECT = `
  id, reference, status, notes, valid_until,
  subtotal, discount_total, net_total, cost_total, margin_total,
  required_approvals, submitted_by, submitted_at,
  customers(id, name),
  quotation_lines(
    id, product_id, qty, discount_pct, unit_price, unit_cost,
    products(id, name, sku, category)
  )
`;

/** Statuses a rep is allowed to edit. Anything further along is locked. */
const EDITABLE_STATUSES = new Set(["draft", "returned", null]);

/** Scalar fields a PATCH may set, alongside `lines`. */
const EDITABLE_FIELDS = ["reference", "notes", "valid_until"] as const;

export async function GET(_request: Request, ctx: RouteContext<"/api/quotations/[id]">) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from("quotations")
    .select(QUOTATION_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Quotation not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}

export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/quotations/[id]">,
) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const supabase = createServerSupabaseClient();

  const { data: existing, error: loadError } = await supabase
    .from("quotations")
    .select("id, status")
    .eq("id", id)
    .maybeSingle<{ id: string; status: string | null }>();

  if (loadError) {
    return NextResponse.json({ error: loadError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Quotation not found" }, { status: 404 });
  }
  if (!EDITABLE_STATUSES.has(existing.status)) {
    return NextResponse.json(
      { error: `A quotation with status "${existing.status}" can no longer be edited` },
      { status: 409 },
    );
  }

  const update: Record<string, unknown> = {};

  for (const field of EDITABLE_FIELDS) {
    if (field in payload) {
      const value = payload[field];
      if (value !== null && typeof value !== "string") {
        return NextResponse.json(
          { error: `${field} must be a string or null` },
          { status: 400 },
        );
      }
      update[field] = value;
    }
  }

  // `lines` is optional: omit it to edit only the scalar fields above.
  const hasLines = "lines" in payload;
  const lines = hasLines ? parseLines(payload.lines) : null;

  if (hasLines && !lines) {
    return NextResponse.json({ error: LINES_SHAPE_ERROR }, { status: 400 });
  }

  // `submit: true` sends the quotation for approval instead of leaving it a draft.
  const submit = payload.submit === true;

  if (Object.keys(update).length === 0 && !hasLines && !submit) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  let requiredApprovals: RequiredApproval[] = [];

  if (lines) {
    const priced = await priceLines(supabase, lines);
    if (!priced.ok) {
      return NextResponse.json({ error: priced.error }, { status: priced.status });
    }

    requiredApprovals = priced.approvals;
    Object.assign(update, summaryColumns(priced.summary, priced.approvals));

    const linesError = await replaceQuotationLines(
      supabase,
      id,
      lines,
      priced.productsById,
    );
    if (linesError) {
      return NextResponse.json({ error: linesError.error }, { status: 500 });
    }
  }

  if (submit) {
    if (!lines) {
      return NextResponse.json(
        { error: "Submitting requires the quotation lines" },
        { status: 400 },
      );
    }

    update.status = requiredApprovals.length > 0 ? "pending_approval" : "approved";
    update.submitted_by = userId;
    update.submitted_at = new Date().toISOString();
  }

  const { error: updateError } = await supabase
    .from("quotations")
    .update(update)
    .eq("id", id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("quotations")
    .select(QUOTATION_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ...data, requiredApprovals });
}

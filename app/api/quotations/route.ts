import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";
import {
  LINES_SHAPE_ERROR,
  approvalVerdict,
  parseLines,
  priceLines,
  replaceQuotationLines,
  summaryColumns,
} from "@/lib/quotations-server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

/**
 * GET  /api/quotations?repId=&status=  — list the pipeline (B2)
 * POST /api/quotations                 — create a draft, optionally with lines
 *
 * Editing lines and submitting for approval live on
 * `PATCH /api/quotations/[id]`.
 *
 * The two verbs are authorized separately: an approver may read every quotation
 * but may not raise one, because the matrix gives them review-only access to the
 * builder.
 */

export type QuotationListRow = {
  id: string;
  reference: string | null;
  status: string | null;
  rep_id: string;
  net_total: number | null;
  updated_at: string | null;
  customers: { id: string; name: string | null } | null;
};

export async function GET(request: Request) {
  const authorized = await requireCapability("quotationBuilder", "view");
  if (!authorized.ok) return authorized.response;

  const { actor } = authorized;
  const params = new URL(request.url).searchParams;
  const supabase = createServerSupabaseClient();

  let query = supabase
    .from("quotations")
    .select("id, reference, status, rep_id, net_total, updated_at, customers(id, name)")
    .order("updated_at", { ascending: false });

  // A rep sees only their own pipeline, whatever they ask for. The filter is
  // applied before the caller's, so `?repId=` cannot widen it.
  if (actor.scope === "own") {
    query = query.eq("rep_id", actor.userId);
  } else {
    const repId = params.get("repId");
    if (repId) query = query.eq("rep_id", repId);
  }

  const status = params.get("status");
  if (status) query = query.eq("status", status);

  const { data, error } = await query.returns<QuotationListRow[]>();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ quotations: data ?? [], scope: actor.scope });
}

export async function POST(request: Request) {
  // Creating a quotation is a write: reps and admins only, never an approver.
  const authorized = await requireCapability("quotationBuilder", "write");
  if (!authorized.ok) return authorized.response;

  const { actor } = authorized;

  let payload: {
    customerId?: unknown;
    reference?: unknown;
    lines?: unknown;
    submit?: unknown;
  };
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  const { customerId, reference } = payload;
  if (customerId !== undefined && customerId !== null && typeof customerId !== "string") {
    return NextResponse.json({ error: "customerId must be a string" }, { status: 400 });
  }
  if (reference !== undefined && reference !== null && typeof reference !== "string") {
    return NextResponse.json({ error: "reference must be a string" }, { status: 400 });
  }

  // `lines` is optional: the pipeline's quick-create raises an empty draft, the
  // builder posts a whole quotation in one go.
  const hasLines = "lines" in payload;
  const lines = hasLines ? parseLines(payload.lines) : null;

  if (hasLines && !lines) {
    return NextResponse.json({ error: LINES_SHAPE_ERROR }, { status: 400 });
  }

  // `submit: true` sends the quotation straight for approval rather than
  // leaving it a draft, so raising and submitting is one round trip.
  const submit = payload.submit === true;

  if (submit && (!lines || lines.length === 0)) {
    return NextResponse.json(
      { error: "A quotation needs at least one line before it can be submitted" },
      { status: 400 },
    );
  }
  if (submit && !customerId) {
    return NextResponse.json(
      { error: "A quotation needs a customer before it can be submitted" },
      { status: 400 },
    );
  }

  const supabase = createServerSupabaseClient();

  // Priced before the insert so a bad line fails without leaving an orphan draft.
  const priced = lines && lines.length > 0 ? await priceLines(supabase, lines) : null;
  if (priced && !priced.ok) {
    return NextResponse.json({ error: priced.error }, { status: priced.status });
  }

  // A quote that trips no rule is approved outright — parking it in
  // pending_approval would put it in a queue no level would ever clear.
  const status = !submit
    ? "draft"
    : priced && priced.approvals.length > 0
      ? "pending_approval"
      : "approved";

  const { data, error } = await supabase
    .from("quotations")
    .insert({
      // The owning rep is the caller, taken from the session. It is never read
      // from the body — that is the whole reason the client does not send it.
      rep_id: actor.userId,
      customer_id: customerId ?? null,
      reference: reference ?? null,
      status,
      submitted_by: submit ? actor.userId : null,
      submitted_at: submit ? new Date().toISOString() : null,
      ...(priced ? summaryColumns(priced.summary, priced.approvals) : {}),
    })
    .select("id, reference, status, rep_id, customer_id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (priced && lines) {
    const linesError = await replaceQuotationLines(
      supabase,
      data.id,
      lines,
      priced.productsById,
    );
    if (linesError) {
      return NextResponse.json({ error: linesError.error }, { status: 500 });
    }
  }

  return NextResponse.json(
    {
      ...data,
      ...(priced
        ? approvalVerdict(priced.summary, priced.approvals)
        : {
            blendedRiskScore: 0,
            needsManager: false,
            needsFinance: false,
            needsAdmin: false,
            requiredApprovals: [],
          }),
    },
    { status: 201 },
  );
}

import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase-server";

/**
 * GET  /api/quotations?repId=&status=  — list the pipeline (B2)
 * POST /api/quotations                 — create a draft
 *
 * Editing lines and submitting for approval live on
 * `PATCH /api/quotations/[id]`.
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
  const { userId } = await currentUser();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const supabase = createServerSupabaseClient();

  let query = supabase
    .from("quotations")
    .select("id, reference, status, rep_id, net_total, updated_at, customers(id, name)")
    .order("updated_at", { ascending: false });

  const repId = params.get("repId");
  if (repId) query = query.eq("rep_id", repId);

  const status = params.get("status");
  if (status) query = query.eq("status", status);

  const { data, error } = await query.returns<QuotationListRow[]>();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ quotations: data ?? [] });
}

export async function POST(request: Request) {
  const { userId } = await currentUser();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: { customerId?: unknown; reference?: unknown };
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

  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from("quotations")
    .insert({
      rep_id: userId,
      customer_id: customerId ?? null,
      reference: reference ?? null,
      status: "draft",
    })
    .select("id, reference, status, rep_id, customer_id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}

import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase-server";

/** B8 — negotiation thread. RLS limits both sides to their own quotations. */

export type NegotiationMessage = {
  id: string;
  quotation_id: string;
  author_id: string;
  author_kind: "rep" | "customer";
  body: string;
  created_at: string;
};

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/quotations/[id]/negotiation">,
) {
  const { userId } = await currentUser();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from("negotiation_messages")
    .select("id, quotation_id, author_id, author_kind, body, created_at")
    .eq("quotation_id", id)
    .order("created_at", { ascending: true })
    .returns<NegotiationMessage[]>();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ messages: data ?? [] });
}

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/quotations/[id]/negotiation">,
) {
  const { userId, role } = await currentUser();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;

  let payload: { body?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const body = typeof payload.body === "string" ? payload.body.trim() : "";
  if (!body) {
    return NextResponse.json({ error: "body is required" }, { status: 400 });
  }

  // A portal customer has no staff role; anyone with one is posting as the rep.
  const authorKind: NegotiationMessage["author_kind"] = role ? "rep" : "customer";

  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from("negotiation_messages")
    .insert({
      quotation_id: id,
      author_id: userId,
      author_kind: authorKind,
      body,
    })
    .select("id, quotation_id, author_id, author_kind, body, created_at")
    .single<NegotiationMessage>();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ message: data }, { status: 201 });
}

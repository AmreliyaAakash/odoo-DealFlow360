import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";
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
  const authorized = await requireCapability("customerPortal", "view");
  if (!authorized.ok) return authorized.response;

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
  // Posting to the thread is a write: the customer who owns the quotation, or
  // the rep answering them. RLS narrows it further to their own quotation.
  const authorized = await requireCapability("customerPortal", "write");
  if (!authorized.ok) return authorized.response;

  const { actor } = authorized;
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

  // The portal side is the `customer` role; every other role that can write
  // here is staff answering them.
  const authorKind: NegotiationMessage["author_kind"] =
    actor.role === "customer" ? "customer" : "rep";

  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from("negotiation_messages")
    .insert({
      quotation_id: id,
      author_id: actor.userId,
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

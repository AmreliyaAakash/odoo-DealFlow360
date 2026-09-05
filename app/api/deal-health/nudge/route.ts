import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { resolveUserNames } from "@/lib/users-server";

/**
 * B9 — act on an alert.
 *
 * A nudge chases the deal; an escalation says it is no longer the owner's alone.
 * Neither changes the quotation: the point of the dashboard is to surface deals
 * that have gone quiet, and silently moving one along would hide exactly the
 * problem it was raised for. What it leaves is a dated, attributed record that
 * the deal was chased, and by whom.
 */

const ALERTS = ["stalled", "discount_anomaly", "slipped"] as const;
const ACTIONS = ["nudge", "escalate"] as const;

type Alert = (typeof ALERTS)[number];
type Action = (typeof ACTIONS)[number];

export type DealNudge = {
  id: string;
  quotation_id: string;
  alert: Alert;
  action: Action;
  note: string | null;
  actor_id: string;
  actor_name: string | null;
  created_at: string;
};

export async function POST(request: Request) {
  // Acting on an alert is a write. A rep has view-only access to deal health, so
  // they see their flagged deals without being able to file a chase against them.
  const authorized = await requireCapability("dealHealth", "write");
  if (!authorized.ok) return authorized.response;

  const { actor } = authorized;

  let payload: {
    quotationId?: unknown;
    alert?: unknown;
    action?: unknown;
    note?: unknown;
  };
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

  if (!isOneOf(payload.alert, ALERTS)) {
    return NextResponse.json(
      { error: `alert must be one of: ${ALERTS.join(", ")}` },
      { status: 400 },
    );
  }
  if (!isOneOf(payload.action, ACTIONS)) {
    return NextResponse.json(
      { error: `action must be one of: ${ACTIONS.join(", ")}` },
      { status: 400 },
    );
  }

  const note = typeof payload.note === "string" ? payload.note.trim() : "";

  const supabase = createServerSupabaseClient();

  // Snapshotted at write time, so the log stays readable after the account is
  // renamed or removed — the same rule the config audit log follows.
  const names = await resolveUserNames([actor.userId]);
  const actorName = names.get(actor.userId) ?? null;

  const { data, error } = await supabase
    .from("deal_nudges")
    .insert({
      quotation_id: quotationId,
      alert: payload.alert,
      action: payload.action,
      note: note.length > 0 ? note : null,
      actor_id: actor.userId,
      actor_name: actorName,
    })
    .select("id, quotation_id, alert, action, note, actor_id, actor_name, created_at")
    .single<DealNudge>();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

function isOneOf<T extends readonly string[]>(
  value: unknown,
  options: T,
): value is T[number] {
  return typeof value === "string" && (options as readonly string[]).includes(value);
}

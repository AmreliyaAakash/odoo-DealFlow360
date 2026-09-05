import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { ApprovalLevel } from "@/lib/business-logic";
import { createServerSupabaseClient } from "@/lib/supabase-server";

const ACTIONS = ["approve", "reject", "return"] as const;
type Action = (typeof ACTIONS)[number];

const APPROVER_LEVELS: ApprovalLevel[] = ["manager", "finance", "admin"];

/** Only a submitted quotation can be decided on. */
const DECIDABLE_STATUSES = new Set(["pending_approval"]);

const STATUS_BY_ACTION: Record<Exclude<Action, "approve">, string> = {
  reject: "rejected",
  return: "returned",
};

function isAction(value: unknown): value is Action {
  return typeof value === "string" && (ACTIONS as readonly string[]).includes(value);
}

type QuotationRow = {
  id: string;
  status: string | null;
  required_approvals: string[] | null;
};

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/quotations/[id]/approve">,
) {
  const { userId, sessionClaims } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const role = sessionClaims?.publicMetadata?.role;
  if (!role || !APPROVER_LEVELS.includes(role as ApprovalLevel)) {
    return NextResponse.json(
      { error: "Your role cannot approve quotations" },
      { status: 403 },
    );
  }
  const level = role as ApprovalLevel;

  const { id } = await ctx.params;

  let payload: { action?: unknown; reason?: unknown };
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
  const action = payload.action;

  const reason = payload.reason;
  if (reason !== undefined && reason !== null && typeof reason !== "string") {
    return NextResponse.json({ error: "reason must be a string" }, { status: 400 });
  }

  // Sending a deal back or turning it down has to say why; approving need not.
  if (action !== "approve" && !reason?.trim()) {
    return NextResponse.json(
      { error: `A reason is required to ${action} a quotation` },
      { status: 400 },
    );
  }

  const supabase = createServerSupabaseClient();

  const { data: quotation, error: loadError } = await supabase
    .from("quotations")
    .select("id, status, required_approvals")
    .eq("id", id)
    .maybeSingle<QuotationRow>();

  if (loadError) {
    return NextResponse.json({ error: loadError.message }, { status: 500 });
  }
  if (!quotation) {
    return NextResponse.json({ error: "Quotation not found" }, { status: 404 });
  }
  if (!DECIDABLE_STATUSES.has(quotation.status ?? "")) {
    return NextResponse.json(
      { error: `A quotation with status "${quotation.status}" is not awaiting approval` },
      { status: 409 },
    );
  }

  const required = quotation.required_approvals ?? [];
  // Admins can act on anything; other roles only on levels this deal asked for.
  if (level !== "admin" && !required.includes(level)) {
    return NextResponse.json(
      { error: `This quotation does not require ${level} approval` },
      { status: 403 },
    );
  }

  const { error: insertError } = await supabase.from("approvals").insert({
    quotation_id: id,
    level,
    action,
    reason: typeof reason === "string" ? reason.trim() : null,
    decided_by: userId,
    decided_at: new Date().toISOString(),
  });

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  const status = await nextStatus(supabase, id, action, required);

  const { error: updateError } = await supabase
    .from("quotations")
    .update({ status })
    .eq("id", id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  const outstanding =
    status === "pending_approval"
      ? await outstandingLevels(supabase, id, required)
      : [];

  return NextResponse.json({ id, action, level, status, outstandingApprovals: outstanding });
}

/**
 * Rejecting or returning ends the round immediately. Approving only advances the
 * quotation once every level it required has signed off.
 */
async function nextStatus(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  quotationId: string,
  action: Action,
  required: string[],
): Promise<string> {
  if (action !== "approve") {
    return STATUS_BY_ACTION[action];
  }

  const outstanding = await outstandingLevels(supabase, quotationId, required);
  return outstanding.length === 0 ? "approved" : "pending_approval";
}

async function outstandingLevels(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  quotationId: string,
  required: string[],
): Promise<string[]> {
  const { data } = await supabase
    .from("approvals")
    .select("level")
    .eq("quotation_id", quotationId)
    .eq("action", "approve")
    .returns<{ level: string }[]>();

  const approved = new Set((data ?? []).map((row) => row.level));
  return required.filter((level) => !approved.has(level));
}

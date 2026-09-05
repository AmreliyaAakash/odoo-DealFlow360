import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";
import {
  APPROVAL_LEVELS,
  APPROVAL_LEVEL_NAMES,
  approvalLevelForRole,
  canActAtLevel,
  type ApprovalLevelName,
} from "@/lib/permissions";
import { createServerSupabaseClient } from "@/lib/supabase-server";

const ACTIONS = ["approve", "reject", "return"] as const;
type Action = (typeof ACTIONS)[number];

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
  /** Start of the current approval round. */
  submitted_at: string | null;
};

/**
 * Decide on a quotation.
 *
 * Reaching this endpoint is not the same as being allowed to act on it. The
 * matrix gives managers level 1 and finance level 2, so a manager who calls this
 * against a finance-level requirement is refused — with a valid session, a real
 * role, and a quotation they are otherwise allowed to read.
 */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/quotations/[id]/approve">,
) {
  // Deciding is a write. A rep has view-only access to approvals, so they are
  // turned away here even for their own quotation.
  const authorized = await requireCapability("approvals", "write");
  if (!authorized.ok) return authorized.response;

  const { actor } = authorized;
  const { id } = await ctx.params;

  let payload: { action?: unknown; reason?: unknown; level?: unknown };
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

  const level = resolveLevel(payload.level, actor.role);
  if ("error" in level) {
    return NextResponse.json({ error: level.error }, { status: level.status });
  }

  const supabase = createServerSupabaseClient();

  const { data: quotation, error: loadError } = await supabase
    .from("quotations")
    .select("id, status, required_approvals, submitted_at")
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
  if (actor.role !== "admin" && !required.includes(level.name)) {
    return NextResponse.json(
      { error: `This quotation does not require ${level.name} approval` },
      { status: 403 },
    );
  }

  const { error: insertError } = await supabase.from("approvals").insert({
    quotation_id: id,
    level: level.name,
    action,
    reason: typeof reason === "string" ? reason.trim() : null,
    decided_by: actor.userId,
    decided_at: new Date().toISOString(),
  });

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  const status = await nextStatus(
    supabase,
    id,
    action,
    required,
    quotation.submitted_at,
  );

  const { error: updateError } = await supabase
    .from("quotations")
    .update({ status })
    .eq("id", id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  const outstanding =
    status === "pending_approval"
      ? await outstandingLevels(supabase, id, required, quotation.submitted_at)
      : [];

  return NextResponse.json({
    id,
    action,
    level: level.name,
    levelNumber: APPROVAL_LEVELS[level.name],
    status,
    outstandingApprovals: outstanding,
  });
}

/**
 * Works out which tier this decision is recorded at, and refuses one the caller
 * may not act at.
 *
 * The tier can be named explicitly in the body — as `1`/`2` or as a role name —
 * which is what lets a client be specific about what it thinks it is clearing.
 * Omitted, it defaults to the caller's own tier. Either way it is checked
 * against the role: a manager naming level 2 is rejected rather than quietly
 * downgraded to level 1, because the two mean different things to the caller.
 */
function resolveLevel(
  requested: unknown,
  role: "manager" | "finance" | "admin" | "rep" | "customer",
): { name: ApprovalLevelName } | { error: string; status: 400 | 403 } {
  const own = approvalLevelForRole(role);

  if (requested === undefined || requested === null) {
    if (own !== null) return { name: APPROVAL_LEVEL_NAMES[own] };
    // An admin acts at whichever tier they name; there is no default for them.
    return {
      error: "level is required: an admin must say which tier they are clearing",
      status: 400,
    };
  }

  const name = asLevelName(requested);
  if (name === null) {
    return {
      error: "level must be 1 (manager) or 2 (finance)",
      status: 400,
    };
  }

  if (!canActAtLevel(role, name)) {
    return {
      error: `A ${role} may not act at level ${APPROVAL_LEVELS[name]} (${name})`,
      status: 403,
    };
  }

  return { name };
}

function asLevelName(value: unknown): ApprovalLevelName | null {
  if (value === 1 || value === "1") return "manager";
  if (value === 2 || value === "2") return "finance";
  if (value === "manager" || value === "finance") return value;
  return null;
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
  roundStartedAt: string | null,
): Promise<string> {
  if (action !== "approve") {
    return STATUS_BY_ACTION[action];
  }

  const outstanding = await outstandingLevels(
    supabase,
    quotationId,
    required,
    roundStartedAt,
  );
  return outstanding.length === 0 ? "approved" : "pending_approval";
}

/**
 * Levels this deal still needs, counting only decisions from the current round.
 *
 * The round matters because a rep may edit a quotation while it is in approval,
 * and doing so moves `submitted_at`. An approval given before that was given on
 * different numbers, so counting it here would let a single sign-off on the new
 * terms clear a deal that two levels had actually been asked about — the exact
 * hole that makes an editable pending quote dangerous rather than convenient.
 */
async function outstandingLevels(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  quotationId: string,
  required: string[],
  roundStartedAt: string | null,
): Promise<string[]> {
  let query = supabase
    .from("approvals")
    .select("level")
    .eq("quotation_id", quotationId)
    .eq("action", "approve");

  if (roundStartedAt) query = query.gte("decided_at", roundStartedAt);

  const { data } = await query.returns<{ level: string }[]>();

  const approved = new Set((data ?? []).map((row) => row.level));
  return required.filter((level) => !approved.has(level));
}

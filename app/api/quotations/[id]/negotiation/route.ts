import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { canWith, effectiveAccess } from "@/lib/permissions-server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { resolveUserNames } from "@/lib/users-server";

/**
 * B8 — the negotiation thread.
 *
 * Three verbs and no fourth: read, post, amend. There is no DELETE handler and
 * no delete policy in the database, because this is the record of what was
 * agreed with a customer. A message that was wrong is edited, and the edit is
 * stamped, so the correction is part of the record rather than a hole in it.
 */

export type NegotiationMessage = {
  id: string;
  quotation_id: string;
  author_id: string;
  author_kind: "rep" | "customer";
  body: string;
  created_at: string;
  /** Null until the author amends it. */
  edited_at: string | null;
};

const SELECT =
  "id, quotation_id, author_id, author_kind, body, created_at, edited_at";

/**
 * The same columns minus `edited_at`, for a database that has not run
 * db/migrations/003-negotiation-chat.sql yet.
 *
 * The same shape as the fallback selects elsewhere in this codebase, and for
 * the same reason: a pending migration should cost the deployment a feature,
 * not the screen. Without this the portal's whole conversation panel returns a
 * PostgREST "column does not exist" and the customer sees an error where their
 * messages were.
 */
const LEGACY_SELECT =
  "id, quotation_id, author_id, author_kind, body, created_at";

/** True when Postgres refused because the column is not there (42703). */
function isMissingColumn(error: { code?: string; message?: string } | null): boolean {
  return (
    error?.code === "42703" ||
    Boolean(error?.message && /edited_at/.test(error.message))
  );
}

const MAX_BODY = 4000;

/**
 * Who may read a thread at all.
 *
 * Two doors, because two different people arrive here. The customer comes
 * through `customerPortal`, which is the module the portal is built on. Staff
 * come through `quotationBuilder`, and that is the whole of the visibility
 * rule: a rep holds it at `own` scope so their token only ever resolves their
 * own quotations, while a manager, finance user or admin holds it at `all`.
 *
 * Neither door filters rows. `negotiation_messages_read` defers to the
 * quotations policy, which applies exactly the same distinction in the
 * database — so a rep who reached this endpoint for somebody else's quotation
 * gets an empty list, not a leak.
 */
async function authorizeRead() {
  const { userId, role } = await currentUser();
  if (!userId) return { ok: false as const, status: 401, error: "Unauthorized" };

  const { access } = await effectiveAccess(userId, role);

  const asCustomer = canWith(access, "customerPortal", "view");
  const asStaff = canWith(access, "quotationBuilder", "view");

  if (!asCustomer && !asStaff) {
    return { ok: false as const, status: 403, error: "You cannot view this conversation" };
  }

  return { ok: true as const, userId, role };
}

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/quotations/[id]/negotiation">,
) {
  const authorized = await authorizeRead();
  if (!authorized.ok) {
    return NextResponse.json({ error: authorized.error }, { status: authorized.status });
  }

  const { id } = await ctx.params;
  const supabase = createServerSupabaseClient();

  const read = (columns: string) =>
    supabase
      .from("negotiation_messages")
      .select(columns)
      .eq("quotation_id", id)
      .order("created_at", { ascending: true })
      .returns<NegotiationMessage[]>();

  let { data, error } = await read(SELECT);

  if (error && isMissingColumn(error)) {
    const legacy = await read(LEGACY_SELECT);
    // Nothing has been edited if the column to record it does not exist.
    data = (legacy.data ?? []).map((row) => ({ ...row, edited_at: null }));
    error = legacy.error;
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const messages = data ?? [];

  // Staff see who on the desk wrote what; the customer sees "your account
  // manager" and no names at all. Which of your colleagues handled a thread is
  // internal, and the portal is the one screen an outside party reads.
  const authors =
    authorized.role === "customer"
      ? {}
      : Object.fromEntries(
          await resolveUserNames(
            messages.filter((m) => m.author_kind === "rep").map((m) => m.author_id),
          ),
        );

  // The caller's own id, so the client can tell which bubbles it may edit
  // without a second round trip or a guess from author_kind.
  return NextResponse.json({ messages, viewerId: authorized.userId, authors });
}

export async function POST(
  request: Request,
  ctx: RouteContext<"/api/quotations/[id]/negotiation">,
) {
  // Posting is a write on the portal module: the customer who owns the
  // quotation, or the rep answering them. A manager or finance user reading
  // over their shoulder has no customerPortal grant and is refused here, and
  // by RLS after that.
  const { userId, role } = await currentUser();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { access } = await effectiveAccess(userId, role);
  if (!canWith(access, "customerPortal", "write")) {
    return NextResponse.json(
      { error: "You can read this conversation but not post to it" },
      { status: 403 },
    );
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
  if (body.length > MAX_BODY) {
    return NextResponse.json({ error: "That message is too long" }, { status: 400 });
  }

  // The portal side is the `customer` role; every other role that can write
  // here is staff answering them.
  const authorKind: NegotiationMessage["author_kind"] =
    role === "customer" ? "customer" : "rep";

  const supabase = createServerSupabaseClient();

  const row = {
    quotation_id: id,
    author_id: userId,
    author_kind: authorKind,
    body,
  };

  const insert = (columns: string) =>
    supabase
      .from("negotiation_messages")
      .insert(row)
      .select(columns)
      .single<NegotiationMessage>();

  let { data, error } = await insert(SELECT);

  if (error && isMissingColumn(error)) {
    // PostgREST issues the insert and its RETURNING clause as one statement, so
    // naming a column that does not exist aborts the write rather than just the
    // read-back — nothing was inserted, and the retry is a fresh insert rather
    // than a re-read of a row that is not there.
    const legacy = await insert(LEGACY_SELECT);
    data = legacy.data ? { ...legacy.data, edited_at: null } : null;
    error = legacy.error;
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ message: data }, { status: 201 });
}

/**
 * Amend one's own message.
 *
 * The `author_id` filter here is belt to the database's braces: the UPDATE
 * policy already refuses somebody else's row, but a query that would have
 * matched it is worth never sending. `edited_at` is stamped server-side so the
 * client cannot post an edit that looks like an original.
 */
export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/quotations/[id]/negotiation">,
) {
  const { userId, role } = await currentUser();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { access } = await effectiveAccess(userId, role);
  if (!canWith(access, "customerPortal", "write")) {
    return NextResponse.json(
      { error: "You cannot edit messages in this conversation" },
      { status: 403 },
    );
  }

  const { id } = await ctx.params;

  let payload: { messageId?: unknown; body?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const messageId = typeof payload.messageId === "string" ? payload.messageId : "";
  const body = typeof payload.body === "string" ? payload.body.trim() : "";

  if (!messageId) {
    return NextResponse.json({ error: "messageId is required" }, { status: 400 });
  }
  if (!body) {
    // Emptying a message is deleting it by another route, so it is refused the
    // same way a delete would be.
    return NextResponse.json(
      { error: "A message cannot be emptied. Edit it to say what changed." },
      { status: 400 },
    );
  }
  if (body.length > MAX_BODY) {
    return NextResponse.json({ error: "That message is too long" }, { status: 400 });
  }

  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from("negotiation_messages")
    .update({ body, edited_at: new Date().toISOString() })
    .eq("id", messageId)
    .eq("quotation_id", id)
    .eq("author_id", userId)
    .select(SELECT)
    .maybeSingle<NegotiationMessage>();

  if (error && isMissingColumn(error)) {
    // Editing needs somewhere to record that it happened, and an unstamped edit
    // is worse than no edit at all — so this stays refused until the migration
    // has run. The detail goes to the log, not to whoever is typing.
    console.error(
      "[negotiation] edit refused: db/migrations/003-negotiation-chat.sql has not been applied",
    );
    return NextResponse.json(
      { error: "Editing is not available on this deployment yet." },
      { status: 503 },
    );
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // No row came back: either it is not theirs or it is not on this quotation.
  // One message for both, so the response cannot be used to probe for messages
  // the caller cannot see.
  if (!data) {
    return NextResponse.json(
      { error: "That message is not yours to edit" },
      { status: 403 },
    );
  }

  return NextResponse.json({ message: data });
}

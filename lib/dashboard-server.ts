import "server-only";
import { shortId } from "@/lib/roles";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { nameFor, resolveUserNames } from "@/lib/users-server";
import type { Scope } from "@/lib/permissions";

/**
 * Screen 2 — the shared dashboard: three figures and what just happened.
 *
 * Deliberately thinner than the role desks at /rep, /manager and /finance. This
 * is the screen somebody opens to find out whether anything needs them; the
 * desk screens are where the work is done. Keeping it a summary is what lets
 * every role share one route without any of them getting a page full of
 * controls they cannot use.
 */

export type ActivityKind = "submitted" | "decision" | "message" | "closed";

export type ActivityEvent = {
  id: string;
  kind: ActivityKind;
  quotationId: string;
  reference: string;
  actor: string;
  summary: string;
  at: string;
};

export type Overview = {
  openQuotations: number;
  openValue: number;
  pendingApprovals: number;
  pendingValue: number;
  wonThisMonth: number;
  wonValue: number;
  activity: ActivityEvent[];
  error: string | null;
};

/** Everything that is still live — the deals somebody could still move. */
const OPEN_STATUSES = ["draft", "pending_approval", "returned", "approved"];

type QuoteRow = {
  id: string;
  reference: string | null;
  rep_id: string;
  status: string | null;
  net_total: number | null;
  submitted_at: string | null;
  updated_at: string | null;
  created_at: string | null;
};

export async function loadOverview(
  userId: string,
  scope: Scope,
): Promise<Overview> {
  const supabase = createServerSupabaseClient();

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const mine = <T>(query: T): T =>
    // A rep scoped to "own" must not see the desk's totals even where RLS
    // would allow it — the scope is the grant, and the numbers on this screen
    // are the first thing anyone quotes in a meeting.
    scope === "own"
      ? ((query as { eq: (c: string, v: string) => T }).eq("rep_id", userId) as T)
      : query;

  const [quotes, decisions, messages] = await Promise.all([
    mine(
      supabase
        .from("quotations")
        .select(
          "id, reference, rep_id, status, net_total, submitted_at, updated_at, created_at",
        )
        .order("updated_at", { ascending: false, nullsFirst: false })
        .limit(400),
    ).returns<QuoteRow[]>(),
    supabase
      .from("approvals")
      .select("id, quotation_id, level, action, decided_by, decided_at")
      .order("decided_at", { ascending: false })
      .limit(20)
      .returns<
        {
          id: string;
          quotation_id: string;
          level: string;
          action: string;
          decided_by: string;
          decided_at: string;
        }[]
      >(),
    supabase
      .from("negotiation_messages")
      .select("id, quotation_id, author_id, author_kind, created_at")
      .order("created_at", { ascending: false })
      .limit(20)
      .returns<
        {
          id: string;
          quotation_id: string;
          author_id: string;
          author_kind: string;
          created_at: string;
        }[]
      >(),
  ]);

  const error =
    quotes.error?.message ??
    decisions.error?.message ??
    messages.error?.message ??
    null;

  const rows = quotes.data ?? [];
  const byId = new Map(rows.map((row) => [row.id, row]));
  const reference = (id: string) => byId.get(id)?.reference ?? shortId(id);

  const open = rows.filter((row) => OPEN_STATUSES.includes(row.status ?? ""));
  const pending = rows.filter((row) => row.status === "pending_approval");
  const won = rows.filter(
    (row) =>
      row.status === "won" &&
      row.updated_at !== null &&
      new Date(row.updated_at) >= monthStart,
  );

  const sum = (list: QuoteRow[]) =>
    list.reduce((total, row) => total + Number(row.net_total ?? 0), 0);

  /* Activity ----------------------------------------------------------- */

  const names = await resolveUserNames([
    ...rows.map((row) => row.rep_id),
    ...(decisions.data ?? []).map((row) => row.decided_by),
    ...(messages.data ?? [])
      .filter((row) => row.author_kind === "rep")
      .map((row) => row.author_id),
  ]);

  const events: ActivityEvent[] = [];

  for (const row of rows) {
    if (row.status === "pending_approval" && row.submitted_at) {
      events.push({
        id: `submit-${row.id}`,
        kind: "submitted",
        quotationId: row.id,
        reference: row.reference ?? shortId(row.id),
        actor: nameFor(names, row.rep_id),
        summary: "submitted for approval",
        at: row.submitted_at,
      });
    }

    if ((row.status === "won" || row.status === "lost") && row.updated_at) {
      events.push({
        id: `close-${row.id}`,
        kind: "closed",
        quotationId: row.id,
        reference: row.reference ?? shortId(row.id),
        actor: nameFor(names, row.rep_id),
        summary: row.status === "won" ? "marked won" : "marked lost",
        at: row.updated_at,
      });
    }
  }

  for (const row of decisions.data ?? []) {
    // Decisions can arrive on quotations outside the scoped page of quotes
    // above; skipping those keeps a scoped rep from reading another rep's
    // reference out of the feed.
    if (scope === "own" && !byId.has(row.quotation_id)) continue;

    events.push({
      id: `decision-${row.id}`,
      kind: "decision",
      quotationId: row.quotation_id,
      reference: reference(row.quotation_id),
      actor: nameFor(names, row.decided_by),
      summary:
        row.action === "approve"
          ? `approved at ${row.level} level`
          : row.action === "reject"
            ? "rejected the quotation"
            : "returned it to the rep",
      at: row.decided_at,
    });
  }

  for (const row of messages.data ?? []) {
    if (scope === "own" && !byId.has(row.quotation_id)) continue;

    events.push({
      id: `message-${row.id}`,
      kind: "message",
      quotationId: row.quotation_id,
      reference: reference(row.quotation_id),
      actor:
        row.author_kind === "customer"
          ? "Customer"
          : nameFor(names, row.author_id),
      summary: "left a message on the portal",
      at: row.created_at,
    });
  }

  events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  return {
    openQuotations: open.length,
    openValue: sum(open),
    pendingApprovals: pending.length,
    pendingValue: sum(pending),
    wonThisMonth: won.length,
    wonValue: sum(won),
    activity: events.slice(0, 15),
    error,
  };
}

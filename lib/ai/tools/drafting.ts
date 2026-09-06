import "server-only";
import { daysStalled } from "@/lib/business-logic";
import { formatCurrency } from "@/lib/quotations";
import { statusLabel } from "@/lib/status";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { nameFor, resolveUserNames } from "@/lib/users-server";
import { registerTool } from "../tool-registry";
import type { ChatTool, ToolContext } from "../types";

/**
 * Grounding for a drafted message — a customer follow-up, a rejection reason, an
 * internal note.
 *
 * The failure mode this exists to prevent is a fluent draft containing a
 * commitment nobody made: a delivery date, a discount, a "as we discussed last
 * week". So the tool returns the thread and the facts, and the prompt note
 * forbids anything outside them. A draft is also never sent — there is no write
 * tool here, and the panel hands the text back for the person to paste.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// `margin_total` is selected only because `daysStalled` takes a
// DealHealthQuotation, which requires it. It is never returned to the model —
// margin is a reporting figure, not something a draft needs.
const SELECT = `id, reference, status, rep_id, net_total, margin_total,
   max_discount_pct, updated_at, submitted_at, valid_until, customers(name, tier)`;

type DealRow = {
  id: string;
  reference: string | null;
  status: string | null;
  rep_id: string;
  net_total: number | null;
  margin_total: number | null;
  max_discount_pct: number | null;
  updated_at: string | null;
  submitted_at: string | null;
  valid_until: string | null;
  customers: { name: string | null; tier: string | null } | null;
};

async function dealFor(dealId: string, ctx: ToolContext): Promise<DealRow | null> {
  const supabase = createServerSupabaseClient();

  const scoped = () => {
    const query = supabase.from("quotations").select(SELECT).limit(1);
    return ctx.scope === "own" ? query.eq("rep_id", ctx.userId) : query;
  };

  const byReference = await scoped().eq("reference", dealId).maybeSingle();
  if (byReference.data) return byReference.data as unknown as DealRow;

  if (!UUID.test(dealId)) return null;
  const byId = await scoped().eq("id", dealId).maybeSingle();
  return (byId.data as unknown as DealRow | null) ?? null;
}

const getDraftContext: ChatTool = {
  id: "get_draft_context",
  description:
    "Everything needed to ground a drafted message about one deal: its stage, value, how " +
    "long it has been quiet, the negotiation thread with the customer, and the reasons " +
    "given on any prior approval decision. Call this before drafting anything.",
  module: "quotationBuilder",
  minimum: "view",
  promptNote: `When asked to draft a customer follow-up, a rejection reason or an \
internal note: call get_draft_context first and ground every specific in what it \
returned — the amount, the stage, how many days it has been quiet, what was \
actually said in the thread. Never invent a customer contact's name, a past \
conversation, a delivery date, a discount, or any commitment that is not in the \
fetched context. Always present the result as an editable draft, opening with \
"Here's a draft — edit before sending:", and never claim to have sent it. You \
cannot send anything.`,
  parameters: {
    type: "object",
    properties: {
      dealId: { type: "string", description: "Quotation reference (e.g. Q-1042) or id." },
    },
    required: ["dealId"],
  },
  execute: async (args, ctx) => {
    const dealId = typeof args.dealId === "string" ? args.dealId.trim() : "";
    if (!dealId) return { error: "No deal reference was given." };

    const deal = await dealFor(dealId, ctx);
    if (!deal) return { error: `No deal "${dealId}" is visible to you.` };

    const supabase = createServerSupabaseClient();

    const [messages, decisions] = await Promise.all([
      supabase
        .from("negotiation_messages")
        .select("author_id, author_kind, body, created_at")
        .eq("quotation_id", deal.id)
        .order("created_at", { ascending: true })
        .limit(20),
      supabase
        .from("approvals")
        .select("level, action, reason, decided_by, decided_at")
        .eq("quotation_id", deal.id)
        .order("decided_at", { ascending: false })
        .limit(5),
    ]);

    const thread = (messages.data ?? []) as {
      author_id: string;
      author_kind: string;
      body: string;
      created_at: string;
    }[];

    const settled = (decisions.data ?? []) as {
      level: string;
      action: string;
      reason: string | null;
      decided_by: string;
      decided_at: string;
    }[];

    const names = await resolveUserNames([
      String(deal.rep_id),
      ...settled.map((row) => row.decided_by),
    ]);

    return {
      reference: deal.reference,
      customer: deal.customers?.name ?? "Unnamed customer",
      customerTier: deal.customers?.tier ?? "standard",
      rep: nameFor(names, String(deal.rep_id)),
      stage: statusLabel(deal.status ?? "draft"),
      value: formatCurrency(Number(deal.net_total ?? 0)),
      maxDiscountPct: Number(deal.max_discount_pct ?? 0),
      businessDaysQuiet: daysStalled(deal, new Date()),
      validUntil: deal.valid_until,
      // Verbatim, so a draft can refer to what was actually said rather than to
      // a summary of it that has already lost the detail.
      thread: thread.map((message) => ({
        from: message.author_kind === "customer" ? "Customer" : "Us",
        said: message.body,
        at: message.created_at,
      })),
      priorDecisions: settled.map((row) => ({
        level: row.level,
        action: row.action,
        reason: row.reason,
        by: nameFor(names, row.decided_by),
        at: row.decided_at,
      })),
    };
  },
};

registerTool(getDraftContext);

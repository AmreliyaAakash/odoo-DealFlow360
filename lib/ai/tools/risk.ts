import "server-only";
import { discountBaseline } from "@/lib/business-logic";
import { formatCurrency } from "@/lib/quotations";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { nameFor, resolveUserNames } from "@/lib/users-server";
import { registerTool } from "../tool-registry";
import type { ChatTool, ToolContext } from "../types";

/**
 * What an approver would want to know in the ten seconds before they decide.
 *
 * Three comparisons, all from settled business rather than the open pipeline:
 * this rep against their own history, this customer against their payment and
 * credit record, and this deal against similar recent ones. None of it is a
 * recommendation — the tool returns comparisons and the prompt note is emphatic
 * that the model must not turn them into a verdict. An approval is somebody's
 * job, and this is briefing material for it.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SETTLED = ["won", "lost"];

/** Comparable = same order of magnitude, settled, not this deal. */
const COMPARABLE_BAND = 0.5;

const SELECT = `id, reference, status, rep_id, net_total, margin_total,
   max_discount_pct, submitted_at, customer_id, customers(name, tier)`;

type DealRow = {
  id: string;
  reference: string | null;
  status: string | null;
  rep_id: string;
  net_total: number | null;
  margin_total: number | null;
  max_discount_pct: number | null;
  submitted_at: string | null;
  customer_id: string | null;
  customers: { name: string | null; tier: string | null } | null;
};

async function pendingFor(approvalId: string, ctx: ToolContext): Promise<DealRow | null> {
  const supabase = createServerSupabaseClient();

  const scoped = () => {
    const query = supabase.from("quotations").select(SELECT).limit(1);
    return ctx.scope === "own" ? query.eq("rep_id", ctx.userId) : query;
  };

  const byReference = await scoped().eq("reference", approvalId).maybeSingle();
  if (byReference.data) return byReference.data as unknown as DealRow;

  if (!UUID.test(approvalId)) return null;
  const byId = await scoped().eq("id", approvalId).maybeSingle();
  return (byId.data as unknown as DealRow | null) ?? null;
}

const approvalRiskContext: ChatTool = {
  id: "approval_risk_context",
  description:
    "Context for one pending approval: how the discount compares to that rep's own " +
    "settled baseline, the customer's credit-note and payment history, and comparable " +
    "recent deals of similar size. Briefing material for an approver, not a recommendation.",
  module: "approvals",
  minimum: "view",
  promptNote: `On an approval, call approval_risk_context once and summarise in two \
or three sentences: how this discount sits against the rep's own baseline, \
anything in the customer's history, and how it compares to similar recent deals. \
This is context for the approver's judgment — never recommend approving or \
rejecting, never say a deal "should" be approved, and never characterise a rep's \
pattern as misconduct. If a comparison is based on too few settled deals to mean \
anything, say so instead of quoting it.`,
  parameters: {
    type: "object",
    properties: {
      approvalId: {
        type: "string",
        description: "The quotation reference (e.g. Q-1042) or id awaiting decision.",
      },
    },
    required: ["approvalId"],
  },
  execute: async (args, ctx) => {
    const approvalId = typeof args.approvalId === "string" ? args.approvalId.trim() : "";
    if (!approvalId) return { error: "No approval reference was given." };

    const deal = await pendingFor(approvalId, ctx);
    if (!deal) return { error: `No deal "${approvalId}" is visible to you.` };

    const supabase = createServerSupabaseClient();
    const value = Number(deal.net_total ?? 0);

    const [repHistory, customerDeals, credits, comparables] = await Promise.all([
      supabase
        .from("quotations")
        .select("max_discount_pct")
        .eq("rep_id", deal.rep_id)
        .in("status", SETTLED)
        .limit(200),
      deal.customer_id
        ? supabase
            .from("quotations")
            .select("id, reference, status, net_total, max_discount_pct")
            .eq("customer_id", deal.customer_id)
            .in("status", SETTLED)
            .limit(50)
        : Promise.resolve({ data: [] }),
      deal.customer_id
        ? supabase
            .from("credit_notes")
            .select("amount, reason, created_at, orders!inner(customer_id)")
            .eq("orders.customer_id", deal.customer_id)
            .limit(20)
        : Promise.resolve({ data: [] }),
      supabase
        .from("quotations")
        .select("id, reference, rep_id, net_total, max_discount_pct, status")
        .in("status", SETTLED)
        .gte("net_total", value * (1 - COMPARABLE_BAND))
        .lte("net_total", value * (1 + COMPARABLE_BAND))
        .order("submitted_at", { ascending: false, nullsFirst: false })
        .limit(10),
    ]);

    const depths = ((repHistory.data ?? []) as { max_discount_pct: number | null }[]).map(
      (row) => Number(row.max_discount_pct ?? 0),
    );
    const baseline = discountBaseline(depths);
    const quoted = Number(deal.max_discount_pct ?? 0);

    const priorDeals = (customerDeals.data ?? []) as {
      status: string;
      net_total: number | null;
    }[];

    const creditNotes = (credits.data ?? []) as {
      amount: number;
      reason: string;
      created_at: string;
    }[];

    const similar = ((comparables.data ?? []) as {
      id: string;
      reference: string | null;
      rep_id: string;
      net_total: number | null;
      max_discount_pct: number | null;
      status: string;
    }[]).filter((row) => row.id !== deal.id);

    const names = await resolveUserNames([String(deal.rep_id)]);

    return {
      reference: deal.reference,
      customer: deal.customers?.name ?? "Unnamed customer",
      customerTier: deal.customers?.tier ?? "standard",
      rep: nameFor(names, String(deal.rep_id)),
      dealValue: formatCurrency(value),
      quotedDiscountPct: quoted,

      repPattern: {
        settledDealsMeasured: depths.length,
        // Null when there is too little history for a mean to say anything; the
        // prompt note requires the model to admit that rather than quote it.
        baselineDiscountPct: baseline === null ? null : Number(baseline.toFixed(1)),
        pointsAboveBaseline:
          baseline === null ? null : Number((quoted - baseline).toFixed(1)),
      },

      customerHistory: {
        settledDeals: priorDeals.length,
        won: priorDeals.filter((row) => row.status === "won").length,
        lost: priorDeals.filter((row) => row.status === "lost").length,
        lifetimeWonValue: formatCurrency(
          priorDeals
            .filter((row) => row.status === "won")
            .reduce((sum, row) => sum + Number(row.net_total ?? 0), 0),
        ),
        creditNotes: creditNotes.length,
        creditNoteValue: formatCurrency(
          creditNotes.reduce((sum, note) => sum + Number(note.amount ?? 0), 0),
        ),
        creditNoteReasons: [...new Set(creditNotes.map((note) => note.reason))],
      },

      comparableDeals: {
        count: similar.length,
        band: `within ${COMPARABLE_BAND * 100}% of ${formatCurrency(value)}`,
        medianDiscountPct: median(
          similar.map((row) => Number(row.max_discount_pct ?? 0)),
        ),
        wonAtThisDepth: similar.filter(
          (row) => row.status === "won" && Number(row.max_discount_pct ?? 0) >= quoted,
        ).length,
      },
    };
  },
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return Number(
    (sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle]
    ).toFixed(1),
  );
}

registerTool(approvalRiskContext);

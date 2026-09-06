import "server-only";
import { discountBaseline } from "@/lib/business-logic";
import { formatCurrency } from "@/lib/quotations";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { nameFor, resolveUserNames } from "@/lib/users-server";
import { registerTool } from "../tool-registry";
import type { ChatTool } from "../types";

/**
 * A batch of recent deals and invoices for the model to look over.
 *
 * Deliberately on-demand: the user asks for a scan and sees the result. Nothing
 * here runs on a timer, nothing is escalated to anyone, and nothing is written
 * down — a background process that quietly files reports about named people is
 * a different product, and not one this feature is authorised to become.
 *
 * The tool returns facts and the per-rep baselines needed to read them. It does
 * not decide what is anomalous; the prompt note tells the model what counts and,
 * more importantly, how to phrase it.
 */

const MAX_SINCE_DAYS = 180;
const MAX_LIMIT = 60;

type DealRow = {
  id: string;
  reference: string | null;
  status: string | null;
  rep_id: string;
  net_total: number | null;
  margin_total: number | null;
  max_discount_pct: number | null;
  created_at: string | null;
  updated_at: string | null;
  submitted_at: string | null;
  customers: { name: string | null } | null;
};

type CreditNoteRow = {
  amount: number | null;
  reason: string;
  created_at: string;
  invoice_id: string | null;
  orders: { reference: string | null } | null;
};

const recentDealsBatch: ChatTool = {
  id: "recent_deals_batch",
  description:
    "A batch of recent deals and invoices in the user's scope, with each rep's own " +
    "discount baseline, for reviewing patterns across deals rather than one at a time. " +
    "Use when asked to scan or look for anything unusual.",
  module: "dealHealth",
  minimum: "view",
  promptNote: `When scanning a batch, flag only clear, specific patterns — a rep \
landing repeatedly at exactly the discount ceiling, deals going quiet just before \
month end, credit notes that do not net cleanly against their invoice, the same \
customer repeatedly renegotiating after approval. For each flag name the deals \
involved, the pattern you actually observed in the data, and why it is worth a \
look. Two rules you must not break: this is advisory, so never state or imply \
that anyone did anything wrong, and if nothing clear stands out, say so plainly \
rather than manufacturing a flag. Do not escalate to anyone — you are showing \
this to the person who asked.`,
  parameters: {
    type: "object",
    properties: {
      sinceDays: { type: "integer", description: "How far back to look (default 30, max 180)." },
      limit: { type: "integer", description: "How many deals to review (default 40, max 60)." },
    },
  },
  execute: async (args, ctx) => {
    const sinceDays = Math.min(Math.max(Number(args.sinceDays) || 30, 1), MAX_SINCE_DAYS);
    const limit = Math.min(Math.max(Number(args.limit) || 40, 1), MAX_LIMIT);

    const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
    const supabase = createServerSupabaseClient();

    let dealQuery = supabase
      .from("quotations")
      .select(
        `id, reference, status, rep_id, net_total, margin_total, max_discount_pct,
         created_at, updated_at, submitted_at, customers(name)`,
      )
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (ctx.scope === "own") dealQuery = dealQuery.eq("rep_id", ctx.userId);

    // Baselines come from settled history, not from the batch: a window that
    // includes the deals being judged moves its own goalposts.
    const [deals, history, credits] = await Promise.all([
      dealQuery,
      supabase
        .from("quotations")
        .select("rep_id, max_discount_pct")
        .in("status", ["won", "lost"])
        .limit(400),
      // Only where the caller can see billing at all; a rep scanning their own
      // deals has no business reading the credit-note ledger.
      ctx.access.billing.capability === "none"
        ? Promise.resolve({ data: [] })
        : supabase
            .from("credit_notes")
            .select("amount, reason, created_at, invoice_id, orders(reference)")
            .gte("created_at", since)
            .limit(40),
    ]);

    if (deals.error) return { error: "Could not read recent deals." };

    const rows = (deals.data ?? []) as unknown as DealRow[];

    const byRep = new Map<string, number[]>();
    for (const row of (history.data ?? []) as {
      rep_id: string;
      max_discount_pct: number | null;
    }[]) {
      const depths = byRep.get(row.rep_id) ?? [];
      depths.push(Number(row.max_discount_pct ?? 0));
      byRep.set(row.rep_id, depths);
    }

    const names = await resolveUserNames(rows.map((row) => String(row.rep_id)));

    return {
      scope: ctx.scope,
      windowDays: sinceDays,
      reviewed: rows.length,
      deals: rows.map((row) => {
        const baseline = discountBaseline(byRep.get(row.rep_id) ?? []);
        const net = Number(row.net_total ?? 0);

        return {
          reference: row.reference ?? String(row.id).slice(0, 8),
          customer: row.customers?.name ?? "Unnamed customer",
          rep: nameFor(names, String(row.rep_id)),
          status: row.status,
          value: formatCurrency(net),
          maxDiscountPct: Number(row.max_discount_pct ?? 0),
          repBaselinePct: baseline === null ? null : Number(baseline.toFixed(1)),
          marginPct:
            net > 0
              ? Number(((Number(row.margin_total ?? 0) / net) * 100).toFixed(1))
              : null,
          createdAt: row.created_at,
          lastActivity: row.updated_at,
          submittedAt: row.submitted_at,
        };
      }),
      creditNotes: ((credits.data ?? []) as unknown as CreditNoteRow[]).map((note) => ({
        order: note.orders?.reference ?? null,
        amount: formatCurrency(Number(note.amount ?? 0)),
        reason: note.reason,
        againstInvoice: Boolean(note.invoice_id),
        at: note.created_at,
      })),
    };
  },
};

registerTool(recentDealsBatch);

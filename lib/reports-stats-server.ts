import "server-only";
import { businessDaysBetween } from "@/lib/business-logic";
import type { Scope } from "@/lib/permissions";
import { createServerSupabaseClient } from "@/lib/supabase-server";

/**
 * Screen 15 — the three headline figures above the report table.
 *
 * They answer the questions a desk asks before it starts filtering: are we
 * quoting, is the desk holding things up, and what is the attach actually
 * working. The filter bar below narrows rows; these stay fixed to the same
 * 90-day window the table opens on, so the numbers do not shift underneath
 * somebody mid-comparison.
 */

export type ReportStats = {
  quotesCreated: number;
  /** Business days from submission to the decision that cleared it. */
  avgApprovalDays: number | null;
  approvalsMeasured: number;
  topUpsoldProduct: string | null;
  topUpsoldCount: number;
  error: string | null;
};

const WINDOW_DAYS = 90;

export async function loadReportStats(
  scope: Scope,
  userId: string,
): Promise<ReportStats> {
  const supabase = createServerSupabaseClient();
  const since = new Date(
    Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  // RLS already narrows a rep to their own rows, but a rep whose scope is
  // "own" while their role can read wider must still see only theirs — the
  // scope is the permission the admin granted, not a side effect of the role.
  let quotationQuery = supabase
    .from("quotations")
    .select("id, submitted_at, status")
    .gte("created_at", since);

  if (scope === "own") quotationQuery = quotationQuery.eq("rep_id", userId);

  const [quotations, rules] = await Promise.all([
    quotationQuery.returns<
      { id: string; submitted_at: string | null; status: string | null }[]
    >(),
    supabase
      .from("upsell_rules")
      .select("suggested_product_id")
      .eq("active", true)
      .returns<{ suggested_product_id: string }[]>(),
  ]);

  if (quotations.error) {
    return {
      quotesCreated: 0,
      avgApprovalDays: null,
      approvalsMeasured: 0,
      topUpsoldProduct: null,
      topUpsoldCount: 0,
      error: quotations.error.message,
    };
  }

  const rows = quotations.data ?? [];
  const ids = rows.map((row) => row.id);

  const [decisions, lines] = await Promise.all([
    ids.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabase
          .from("approvals")
          .select("quotation_id, action, decided_at")
          .in("quotation_id", ids)
          .order("decided_at", { ascending: true })
          .returns<
            { quotation_id: string; action: string; decided_at: string }[]
          >(),
    ids.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabase
          .from("quotation_lines")
          .select("quotation_id, product_id, products(name)")
          .in("quotation_id", ids)
          .returns<
            {
              quotation_id: string;
              product_id: string;
              products: { name: string | null } | null;
            }[]
          >(),
  ]);

  /* Approval turnaround ------------------------------------------------ */

  const submittedAt = new Map(
    rows
      .filter((row) => row.submitted_at)
      .map((row) => [row.id, row.submitted_at as string]),
  );

  // The first decision after submission is the one that measures the desk. A
  // later one on the same quote belongs to a re-submitted round whose clock
  // started somewhere this window may not contain.
  const firstDecision = new Map<string, string>();
  for (const decision of decisions.data ?? []) {
    if (!firstDecision.has(decision.quotation_id)) {
      firstDecision.set(decision.quotation_id, decision.decided_at);
    }
  }

  const spans: number[] = [];
  for (const [quotationId, decidedAt] of firstDecision) {
    const submitted = submittedAt.get(quotationId);
    if (!submitted) continue;
    const days = businessDaysBetween(new Date(submitted), new Date(decidedAt));
    if (days >= 0) spans.push(days);
  }

  const avgApprovalDays =
    spans.length === 0
      ? null
      : Math.round(
          (spans.reduce((sum, days) => sum + days, 0) / spans.length) * 10,
        ) / 10;

  /* Top upsold product ------------------------------------------------- */

  // A product counts as upsold when an active rule suggests it and it ended up
  // on a quote. Counted once per quotation: two lines of the same accessory on
  // one deal is one successful attach, not two.
  const suggested = new Set(
    (rules.data ?? []).map((rule) => rule.suggested_product_id),
  );

  const seen = new Set<string>();
  const tally = new Map<string, { name: string; count: number }>();

  for (const line of lines.data ?? []) {
    if (!suggested.has(line.product_id)) continue;

    const key = `${line.quotation_id}:${line.product_id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const entry = tally.get(line.product_id) ?? {
      name: line.products?.name ?? "Unknown product",
      count: 0,
    };
    entry.count += 1;
    tally.set(line.product_id, entry);
  }

  const top = [...tally.values()].sort((a, b) => b.count - a.count)[0] ?? null;

  return {
    quotesCreated: rows.length,
    avgApprovalDays,
    approvalsMeasured: spans.length,
    topUpsoldProduct: top?.name ?? null,
    topUpsoldCount: top?.count ?? 0,
    error: null,
  };
}

import "server-only";
import {
  discountBaseline,
  type DealHealthQuotation,
} from "@/lib/business-logic";
import { createServerSupabaseClient } from "@/lib/supabase-server";

/**
 * B9 — the deal-health dashboard's data.
 *
 * The interesting half is the baselines. "A discount well above a rep's
 * historical average" needs that average, and it has to come from settled
 * business rather than the open pipeline — otherwise a rep on a discounting
 * spree raises their own baseline as they go, and the anomaly detector quietly
 * stops detecting the thing it exists for.
 */

/** Open quotations shown on the dashboard. */
const OPEN_STATUSES = ["draft", "pending_approval", "returned", "approved"];

/** Settled quotations that a baseline is computed from. */
const SETTLED_STATUSES = ["won", "lost"];

/** How many settled quotations per rep feed a baseline. */
const BASELINE_WINDOW = 200;

export const DEAL_HEALTH_SELECT =
  `id, reference, status, rep_id, net_total, margin_total, max_discount_pct,
   updated_at, submitted_at, valid_until`;

export type DealHealthData = {
  quotations: DealHealthQuotation[];
  /** Mean discount depth per rep, from their settled deals. */
  baselines: Record<string, number>;
  error: string | null;
};

export async function loadDealHealth(
  scopeToRep?: string | null,
): Promise<DealHealthData> {
  const supabase = createServerSupabaseClient();

  let openQuery = supabase
    .from("quotations")
    .select(DEAL_HEALTH_SELECT)
    .in("status", OPEN_STATUSES)
    .order("updated_at", { ascending: false })
    .limit(100);

  if (scopeToRep) openQuery = openQuery.eq("rep_id", scopeToRep);

  const [open, settled] = await Promise.all([
    openQuery.returns<DealHealthQuotation[]>(),
    supabase
      .from("quotations")
      .select("rep_id, max_discount_pct")
      .in("status", SETTLED_STATUSES)
      .limit(BASELINE_WINDOW)
      .returns<{ rep_id: string; max_discount_pct: number | null }[]>(),
  ]);

  const failure = open.error ?? settled.error;

  const depthsByRep = new Map<string, number[]>();
  for (const row of settled.data ?? []) {
    const depths = depthsByRep.get(row.rep_id) ?? [];
    depths.push(Number(row.max_discount_pct ?? 0));
    depthsByRep.set(row.rep_id, depths);
  }

  const baselines: Record<string, number> = {};
  for (const [repId, depths] of depthsByRep) {
    const baseline = discountBaseline(depths);
    // Only reps with enough history get one; the rest are judged on the
    // absolute threshold alone rather than against a number built from two deals.
    if (baseline !== null) baselines[repId] = baseline;
  }

  return {
    quotations: open.data ?? [],
    baselines,
    error: failure?.message ?? null,
  };
}

import { createServerSupabaseClient } from "@/lib/supabase-server";
import type { WatchlistDeal } from "./rep/types";

/** Statuses that still count as live pipeline. */
const ACTIVE = ["draft", "pending_approval", "approved"];

type Row = {
  id: string;
  net_total: number | null;
  max_discount_pct: number | null;
  customers: { name: string | null } | null;
};

/**
 * The sidebar's pipeline rail. Deliberately a small, indexed query — it runs on
 * every dashboard page, unlike the rep dashboard's full aggregate load.
 */
export async function loadWatchlist(repId: string): Promise<WatchlistDeal[]> {
  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from("quotations")
    .select("id, net_total, max_discount_pct, customers(name)")
    .eq("rep_id", repId)
    .in("status", ACTIVE)
    .order("net_total", { ascending: false })
    .limit(3)
    .returns<Row[]>();

  // The rail is decoration; a failure here must not take down the page.
  if (error) return [];

  return (data ?? []).map((row) => ({
    id: row.id,
    customer: row.customers?.name ?? "Unnamed customer",
    amount: Number(row.net_total ?? 0),
    discountPct: Number(row.max_discount_pct ?? 0),
  }));
}

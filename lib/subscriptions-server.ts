import "server-only";
import {
  asCadence,
  subscriptionMrr,
  type BillingCadence,
  type SubscriptionStatus,
} from "@/lib/business-logic";
import { createServerSupabaseClient } from "@/lib/supabase-server";

/**
 * B7 — the subscription book.
 *
 * Read from the `subscriptions` table rather than derived from quotation lines,
 * because a subscription outlives the quote that created it: pausing one is a
 * fact about the subscription, and there is nowhere on a won quotation to
 * record it.
 */

export type SubscriptionRow = {
  id: string;
  customerName: string;
  productName: string;
  planName: string | null;
  cadence: BillingCadence;
  status: SubscriptionStatus;
  qty: number;
  unitPrice: number;
  /** Normalised to one month, so cadences can be summed. */
  mrr: number;
  startedAt: string;
  nextBillOn: string | null;
  quotationId: string | null;
  orderId: string | null;
};

export type SubscriptionBook = {
  subscriptions: SubscriptionRow[];
  counts: Record<SubscriptionStatus, number>;
  /** Monthly recurring revenue across the active ones only. */
  mrr: number;
  error: string | null;
};

type RawSubscription = {
  id: string;
  qty: number;
  unit_price: number;
  cadence: string;
  status: SubscriptionStatus;
  started_at: string;
  next_bill_on: string | null;
  quotation_id: string | null;
  order_id: string | null;
  customers: { name: string | null } | null;
  products: { name: string | null } | null;
  subscription_plans: { name: string | null } | null;
};

const SELECT = `
  id, qty, unit_price, cadence, status, started_at, next_bill_on,
  quotation_id, order_id,
  customers(name), products(name), subscription_plans(name)
`;

export async function loadSubscriptions(
  customerId?: string | null,
): Promise<SubscriptionBook> {
  const supabase = createServerSupabaseClient();

  let query = supabase
    .from("subscriptions")
    .select(SELECT)
    .order("started_at", { ascending: false })
    .limit(200);

  if (customerId) query = query.eq("customer_id", customerId);

  const { data, error } = await query.returns<RawSubscription[]>();

  const subscriptions = (data ?? []).map(toRow);
  const counts: Record<SubscriptionStatus, number> = {
    active: 0,
    paused: 0,
    cancelled: 0,
  };
  for (const row of subscriptions) counts[row.status] += 1;

  return {
    subscriptions,
    counts,
    mrr: round2(subscriptions.reduce((sum, row) => sum + row.mrr, 0)),
    error: error?.message ?? null,
  };
}

export async function loadSubscription(
  id: string,
): Promise<SubscriptionRow | null> {
  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from("subscriptions")
    .select(SELECT)
    .eq("id", id)
    .maybeSingle<RawSubscription>();

  if (error || !data) return null;
  return toRow(data);
}

function toRow(row: RawSubscription): SubscriptionRow {
  const cadence = asCadence(row.cadence);
  const qty = Number(row.qty);
  const unitPrice = Number(row.unit_price);

  return {
    id: row.id,
    customerName: row.customers?.name ?? "Unassigned customer",
    productName: row.products?.name ?? "Unknown product",
    planName: row.subscription_plans?.name ?? null,
    cadence,
    status: row.status,
    qty,
    unitPrice,
    // Paused and cancelled contribute nothing, which is the whole reason the
    // status lives on the subscription rather than being inferred.
    mrr: subscriptionMrr({ status: row.status, cadence, qty, unitPrice }),
    startedAt: row.started_at,
    nextBillOn: row.next_bill_on,
    quotationId: row.quotation_id,
    orderId: row.order_id,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

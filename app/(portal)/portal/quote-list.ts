import {
  asCadence,
  isQuoteClosedLost,
  isQuoteVisibleToCustomer,
  nextBillingDate,
  portalStage,
  type PortalStage,
} from "@/lib/business-logic";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import type { PortalIdentity } from "./guard";

/**
 * Every quotation this customer may see, for the portal's index.
 *
 * The portal used to redirect straight to the newest one, which meant an
 * account with six quotations had five it could not reach — and the desk had no
 * way to send someone to an older quote except by pasting its id. The stage
 * shown per row is the same `portalStage` the detail page steps through, so a
 * quote does not describe itself one way in the list and another way when
 * opened.
 *
 * Three queries rather than a join: the stage depends on message count and
 * committed units, neither of which is a column on the quotation.
 */

export type PortalQuoteSummary = {
  id: string;
  reference: string;
  status: string;
  stage: PortalStage;
  closedLost: boolean;
  netTotal: number;
  lineCount: number;
  messageCount: number;
  validUntil: string | null;
  createdAt: string | null;
};

type QuoteRow = {
  id: string;
  reference: string | null;
  status: string | null;
  net_total: number | null;
  valid_until: string | null;
  created_at: string | null;
  submitted_at: string | null;
  customers: { name: string | null } | null;
  quotation_lines:
    | { id: string; qty: number | null; products: { cadence: string | null } | null }[]
    | null;
};

export async function loadPortalQuotes(
  identity: PortalIdentity,
): Promise<{ quotes: PortalQuoteSummary[]; customerName: string; error: string | null }> {
  const supabase = createServerSupabaseClient();

  // RLS already limits a portal user to their own customer's rows; the explicit
  // filter is here so the query says what it means rather than relying on it.
  const { data, error } = await supabase
    .from("quotations")
    .select(
      `id, reference, status, net_total, valid_until, created_at, submitted_at,
       customers(name),
       quotation_lines(id, qty, products(cadence))`,
    )
    .eq("customer_id", identity.customerId)
    .order("created_at", { ascending: false })
    .limit(50)
    .returns<QuoteRow[]>();

  if (error) return { quotes: [], customerName: "Your organisation", error: error.message };

  // Every row belongs to the same account, so any of them can name it.
  const customerName = data?.[0]?.customers?.name ?? "Your organisation";

  // A draft is a quote the rep is still writing. It is filtered here rather
  // than in the query because "not yet sent" is a rule about the product, not a
  // permission — the same call the detail page makes.
  const visible = (data ?? []).filter((row) => isQuoteVisibleToCustomer(row.status));
  if (visible.length === 0) return { quotes: [], customerName, error: null };

  const ids = visible.map((row) => row.id);

  const [messages, allocations] = await Promise.all([
    supabase.from("negotiation_messages").select("quotation_id").in("quotation_id", ids),
    supabase.from("quotation_allocations").select("quotation_id, qty").in("quotation_id", ids),
  ]);

  const messageCounts = new Map<string, number>();
  for (const row of (messages.data ?? []) as { quotation_id: string }[]) {
    messageCounts.set(row.quotation_id, (messageCounts.get(row.quotation_id) ?? 0) + 1);
  }

  const allocatedUnits = new Map<string, number>();
  for (const row of (allocations.data ?? []) as {
    quotation_id: string;
    qty: number | null;
  }[]) {
    allocatedUnits.set(
      row.quotation_id,
      (allocatedUnits.get(row.quotation_id) ?? 0) + Number(row.qty ?? 0),
    );
  }

  const now = new Date();

  const quotes = visible.map((row) => {
    const lines = row.quotation_lines ?? [];
    const orderedUnits = lines.reduce((sum, line) => sum + Number(line.qty ?? 0), 0);

    const messageCount = messageCounts.get(row.id) ?? 0;

    return {
      id: row.id,
      reference: row.reference ?? row.id.slice(0, 8),
      status: row.status ?? "draft",
      stage: portalStage(
        {
          status: row.status,
          messageCount,
          orderedUnits,
          allocatedUnits: allocatedUnits.get(row.id) ?? 0,
          firstBillDate: firstBillDate(row, now),
        },
        now,
      ),
      closedLost: isQuoteClosedLost(row.status),
      netTotal: Number(row.net_total ?? 0),
      lineCount: lines.length,
      messageCount,
      validUntil: row.valid_until,
      createdAt: row.created_at,
    };
  });

  return { quotes, customerName, error: null };
}

/**
 * Earliest upcoming bill date across the recurring lines, or null if none.
 *
 * The same rule as the detail page's own `firstBillDate`, anchored on
 * submission and falling back to creation — a list that dated the first bill
 * differently would put a row on a different step than the page it opens.
 */
function firstBillDate(row: QuoteRow, now: Date): Date | null {
  const anchor = row.submitted_at ?? row.created_at;
  if (!anchor) return null;

  const dates = (row.quotation_lines ?? [])
    .map((line) => {
      const cadence = asCadence(line.products?.cadence ?? null);
      if (cadence === "one_time") return null;

      return nextBillingDate(
        {
          id: line.id,
          name: "",
          cadence,
          qty: Number(line.qty ?? 0),
          unitPrice: 0,
          anchor,
        },
        now,
      );
    })
    .filter((date): date is Date => date !== null);

  if (dates.length === 0) return null;
  return new Date(Math.min(...dates.map((date) => date.getTime())));
}

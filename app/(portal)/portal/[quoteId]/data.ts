import {
  asCadence,
  isQuoteClosedLost,
  isQuoteVisibleToCustomer,
  nextBillingDate,
  portalStage,
} from "@/lib/business-logic";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { ownsCustomer, type PortalIdentity } from "../guard";
import type { PortalLine, PortalQuote } from "./types";

type LineRow = {
  id: string;
  qty: number | null;
  discount_pct: number | null;
  unit_price: number | null;
  products: {
    name: string | null;
    category: string | null;
    sku: string | null;
    cadence: string | null;
  } | null;
};

type QuoteRow = {
  id: string;
  customer_id: string | null;
  reference: string | null;
  status: string | null;
  notes: string | null;
  valid_until: string | null;
  subtotal: number | null;
  discount_total: number | null;
  net_total: number | null;
  submitted_at: string | null;
  created_at: string | null;
  customers: { name: string | null } | null;
  quotation_lines: LineRow[] | null;
};

export type PortalQuoteResult =
  | { ok: true; quote: PortalQuote }
  /** `notFound` covers both "no such quote" and "not yours" — RLS makes them
   *  indistinguishable, and telling the two apart would leak whether an id
   *  exists. `notReady` is a draft the customer must not see yet. */
  | { ok: false; reason: "notFound" | "notReady" | "error"; message?: string };

/**
 * Loads one quotation for the portal. RLS already limits a portal user to
 * quotations belonging to their own `customers` row, so no owner filter is
 * applied here — but a draft is filtered out in code, because a rep may still be
 * working on it.
 */
export async function loadPortalQuote(
  quoteId: string,
  identity: PortalIdentity,
): Promise<PortalQuoteResult> {
  const supabase = createServerSupabaseClient();

  const [quotation, allocations, messages] = await Promise.all([
    supabase
      .from("quotations")
      .select(
        `id, customer_id, reference, status, notes, valid_until, subtotal, discount_total, net_total,
         submitted_at, created_at,
         customers(name),
         quotation_lines(id, qty, discount_pct, unit_price,
                         products(name, category, sku, cadence))`,
      )
      .eq("id", quoteId)
      .maybeSingle<QuoteRow>(),
    supabase
      .from("quotation_allocations")
      .select("qty")
      .eq("quotation_id", quoteId)
      .returns<{ qty: number | null }[]>(),
    supabase
      .from("negotiation_messages")
      .select("id", { count: "exact", head: true })
      .eq("quotation_id", quoteId),
  ]);

  if (quotation.error) {
    return { ok: false, reason: "error", message: quotation.error.message };
  }
  if (!quotation.data) {
    return { ok: false, reason: "notFound" };
  }

  const row = quotation.data;

  // Ownership is checked against the row, not the route. Reported as notFound so
  // the portal cannot be used to discover which quotation ids exist.
  if (!ownsCustomer(identity, row.customer_id)) {
    return { ok: false, reason: "notFound" };
  }

  if (!isQuoteVisibleToCustomer(row.status)) {
    return { ok: false, reason: "notReady" };
  }

  const rawLines = row.quotation_lines ?? [];
  const lines: PortalLine[] = rawLines.map((line) => {
    const qty = Number(line.qty ?? 0);
    const unitPrice = Number(line.unit_price ?? 0);
    const discountPct = Number(line.discount_pct ?? 0);

    return {
      id: line.id,
      productName: line.products?.name ?? "Item",
      category: line.products?.category ?? "Uncategorized",
      sku: line.products?.sku ?? null,
      qty,
      unitPrice,
      discountPct,
      net: unitPrice * qty * (1 - discountPct / 100),
    };
  });

  const orderedUnits = lines.reduce((sum, line) => sum + line.qty, 0);
  const allocatedUnits = (allocations.data ?? []).reduce(
    (sum, allocation) => sum + Number(allocation.qty ?? 0),
    0,
  );

  const stage = portalStage({
    status: row.status,
    messageCount: messages.count ?? 0,
    orderedUnits,
    allocatedUnits,
    firstBillDate: firstBillDate(row, rawLines),
  });

  return {
    ok: true,
    quote: {
      id: row.id,
      reference: row.reference ?? row.id.slice(0, 10),
      customerName: row.customers?.name ?? "Your organisation",
      stage,
      closedLost: isQuoteClosedLost(row.status),
      validUntil: row.valid_until,
      notes: row.notes,
      subtotal: Number(row.subtotal ?? 0),
      discountTotal: Number(row.discount_total ?? 0),
      netTotal: Number(row.net_total ?? 0),
      lines,
    },
  };
}

/** Earliest upcoming bill date across the recurring lines, or null if none. */
function firstBillDate(row: QuoteRow, lines: LineRow[]): Date | null {
  const anchor = row.submitted_at ?? row.created_at;
  if (!anchor) return null;

  const now = new Date();
  const dates = lines
    .map((line) => {
      const cadence = asCadence(line.products?.cadence ?? null);
      if (cadence === "one_time") return null;

      return nextBillingDate(
        {
          id: line.id,
          name: line.products?.name ?? "",
          cadence,
          qty: Number(line.qty ?? 0),
          unitPrice: Number(line.unit_price ?? 0),
          anchor,
        },
        now,
      );
    })
    .filter((date): date is Date => date !== null);

  if (dates.length === 0) return null;
  return new Date(Math.min(...dates.map((date) => date.getTime())));
}

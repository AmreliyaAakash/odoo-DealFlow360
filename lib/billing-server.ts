import "server-only";
import {
  asCadence,
  CADENCE_MONTHS,
  calculateProration,
  nextBillingDate,
  type BillingCadence,
} from "@/lib/business-logic";
import { createServerSupabaseClient } from "@/lib/supabase-server";

/**
 * B7 — turning a confirmed quotation into an order, and that order into money.
 *
 * The rule that shapes everything here: one-time lines and recurring lines never
 * share an invoice. A customer who buys a server and a support subscription owes
 * one bill now and a different bill every month, and merging them produces a
 * document that is wrong on both counts — it overstates what is due today and
 * hides what recurs. So the order is one thing and its invoices are many.
 */

type Supabase = ReturnType<typeof createServerSupabaseClient>;

/** Days a one-time invoice is given before it is due. */
const PAYMENT_TERMS_DAYS = 30;

export type OrderLine = {
  productId: string;
  productName: string;
  qty: number;
  unitPrice: number;
  discountPct: number;
  cadence: BillingCadence;
  /** Net of this line's discount. */
  net: number;
};

export type CreatedOrder = {
  orderId: string;
  reference: string;
  invoiceIds: string[];
  oneTimeTotal: number;
  recurringTotal: number;
};

type QuotationRow = {
  id: string;
  reference: string | null;
  status: string | null;
  customer_id: string | null;
  submitted_at: string | null;
  created_at: string | null;
  quotation_lines: {
    product_id: string;
    qty: number;
    unit_price: number;
    discount_pct: number;
    products: { name: string | null; cadence: string | null } | null;
  }[];
};

/** Only a confirmed deal becomes an order. */
export const ORDERABLE_STATUSES = new Set(["won"]);

export function orderLines(quotation: QuotationRow): OrderLine[] {
  return quotation.quotation_lines.map((line) => {
    const qty = Number(line.qty);
    const unitPrice = Number(line.unit_price);
    const discountPct = Number(line.discount_pct);

    return {
      productId: line.product_id,
      productName: line.products?.name ?? "Item",
      qty,
      unitPrice,
      discountPct,
      cadence: asCadence(line.products?.cadence ?? null),
      net: round2(unitPrice * qty * (1 - discountPct / 100)),
    };
  });
}

/**
 * Raise the order and its opening invoices.
 *
 * The recurring side bills one period at a time rather than the whole term up
 * front: that is what a subscription is, and it is also what makes a mid-cycle
 * change prorate against something real instead of a lump sum already taken.
 */
export async function createOrderFromQuotation(
  supabase: Supabase,
  quotationId: string,
  actorId: string,
): Promise<CreatedOrder | { error: string; status: number }> {
  const { data: quotation, error } = await supabase
    .from("quotations")
    .select(
      `id, reference, status, customer_id, submitted_at, created_at,
       quotation_lines(product_id, qty, unit_price, discount_pct,
                       products(name, cadence))`,
    )
    .eq("id", quotationId)
    .maybeSingle<QuotationRow>();

  if (error) return { error: error.message, status: 500 };
  if (!quotation) return { error: "Quotation not found", status: 404 };

  if (!ORDERABLE_STATUSES.has(quotation.status ?? "")) {
    return {
      error: `A quotation with status "${quotation.status}" is not confirmed yet`,
      status: 409,
    };
  }

  // One order per quotation is a unique constraint, but answering here turns a
  // constraint violation into something the screen can explain.
  const { data: existing } = await supabase
    .from("orders")
    .select("id")
    .eq("quotation_id", quotationId)
    .maybeSingle<{ id: string }>();

  if (existing) {
    return { error: "This quotation has already been ordered", status: 409 };
  }

  const lines = orderLines(quotation);
  if (lines.length === 0) {
    return { error: "This quotation has no lines to order", status: 409 };
  }

  const reference = orderReference(quotation);

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      quotation_id: quotation.id,
      customer_id: quotation.customer_id,
      reference,
      created_by: actorId,
    })
    .select("id")
    .single<{ id: string }>();

  if (orderError || !order) {
    return { error: orderError?.message ?? "Could not raise the order", status: 500 };
  }

  const anchor = new Date(quotation.submitted_at ?? quotation.created_at ?? Date.now());
  const invoiceIds: string[] = [];

  const oneTime = lines.filter((line) => line.cadence === "one_time");
  const recurring = lines.filter((line) => line.cadence !== "one_time");

  if (oneTime.length > 0) {
    const created = await writeInvoice(supabase, {
      orderId: order.id,
      reference: `${reference}-INV`,
      kind: "one_time",
      lines: oneTime,
      dueDate: addDays(anchor, PAYMENT_TERMS_DAYS),
    });
    if ("error" in created) return { error: created.error, status: 500 };
    invoiceIds.push(created.id);
  }

  // One invoice per subscription line, not one for all of them: they may run on
  // different cadences, and a quarterly and a monthly line on one document could
  // not both be right about the period it covers.
  for (const [index, line] of recurring.entries()) {
    const period = firstPeriod(line.cadence, anchor);

    const created = await writeInvoice(supabase, {
      orderId: order.id,
      reference: `${reference}-SUB${index + 1}`,
      kind: "recurring",
      lines: [line],
      periodStart: period.start,
      periodEnd: period.end,
      dueDate: period.start,
    });
    if ("error" in created) return { error: created.error, status: 500 };
    invoiceIds.push(created.id);
  }

  return {
    orderId: order.id,
    reference,
    invoiceIds,
    oneTimeTotal: total(oneTime),
    recurringTotal: total(recurring),
  };
}

/* ------------------------------------------------------------------ *
 * Payments
 * ------------------------------------------------------------------ */

export type PaymentResult = {
  invoiceId: string;
  amountPaid: number;
  total: number;
  status: string;
};

/**
 * Record a payment and restate the invoice.
 *
 * `amount_paid` is summed from the payments rather than incremented, so a
 * retried request cannot quietly inflate it, and a deleted payment leaves the
 * invoice honest rather than permanently overstated.
 */
export async function recordPayment(
  supabase: Supabase,
  invoiceId: string,
  amount: number,
  method: string,
  reference: string | null,
  actorId: string,
): Promise<PaymentResult | { error: string; status: number }> {
  const { data: invoice, error } = await supabase
    .from("invoices")
    .select("id, total, status")
    .eq("id", invoiceId)
    .maybeSingle<{ id: string; total: number; status: string }>();

  if (error) return { error: error.message, status: 500 };
  if (!invoice) return { error: "Invoice not found", status: 404 };
  if (invoice.status === "void") {
    return { error: "This invoice has been voided", status: 409 };
  }

  const { error: insertError } = await supabase.from("payments").insert({
    invoice_id: invoiceId,
    amount,
    method,
    reference,
    recorded_by: actorId,
  });

  if (insertError) return { error: insertError.message, status: 500 };

  const { data: payments, error: sumError } = await supabase
    .from("payments")
    .select("amount")
    .eq("invoice_id", invoiceId)
    .returns<{ amount: number }[]>();

  if (sumError) return { error: sumError.message, status: 500 };

  const amountPaid = round2(
    (payments ?? []).reduce((sum, row) => sum + Number(row.amount), 0),
  );
  const invoiceTotal = Number(invoice.total);
  const status = paymentStatus(amountPaid, invoiceTotal);

  const { error: updateError } = await supabase
    .from("invoices")
    .update({ amount_paid: amountPaid, status })
    .eq("id", invoiceId);

  if (updateError) return { error: updateError.message, status: 500 };

  return { invoiceId, amountPaid, total: invoiceTotal, status };
}

/**
 * Overpayment still reads as paid rather than as a fifth status nobody has a
 * screen for; the excess is visible in `amount_paid` against `total`.
 */
export function paymentStatus(amountPaid: number, total: number): string {
  if (amountPaid <= 0) return "issued";
  if (amountPaid >= total) return "paid";
  return "part_paid";
}

/* ------------------------------------------------------------------ *
 * Subscription changes
 * ------------------------------------------------------------------ */

export type SubscriptionChange = {
  invoiceId: string;
  /** Positive to charge for an upgrade, negative to credit a downgrade. */
  amount: number;
  /** Set when the change produced a credit rather than a charge. */
  creditNoteId: string | null;
  newInvoiceId: string | null;
};

/**
 * Change the quantity on a running subscription mid-cycle.
 *
 * An increase raises a fresh invoice for the remaining days only; a decrease or
 * a cancellation raises a credit note for the same. Neither touches the invoice
 * already issued: it was correct for the period it covered, and rewriting
 * history would leave the payment against it pointing at a number that no longer
 * exists.
 */
export async function changeSubscription(
  supabase: Supabase,
  invoiceId: string,
  nextQty: number,
  actorId: string,
  reason: "cancellation" | "downgrade" | "correction" = "downgrade",
): Promise<SubscriptionChange | { error: string; status: number }> {
  const { data: invoice, error } = await supabase
    .from("invoices")
    .select(
      "id, order_id, kind, period_start, period_end, total, invoice_lines(id, description, qty, unit_price, product_id)",
    )
    .eq("id", invoiceId)
    .maybeSingle<{
      id: string;
      order_id: string;
      kind: string;
      period_start: string | null;
      period_end: string | null;
      total: number;
      invoice_lines: {
        id: string;
        description: string;
        qty: number;
        unit_price: number;
        product_id: string | null;
      }[];
    }>();

  if (error) return { error: error.message, status: 500 };
  if (!invoice) return { error: "Invoice not found", status: 404 };
  if (invoice.kind !== "recurring") {
    return { error: "Only a recurring invoice can be changed mid-cycle", status: 409 };
  }
  if (!invoice.period_start || !invoice.period_end) {
    return { error: "This invoice has no billing period", status: 409 };
  }

  const line = invoice.invoice_lines[0];
  if (!line) return { error: "This invoice has no lines", status: 409 };

  const { amount } = calculateProration({
    unitPrice: Number(line.unit_price),
    previousQty: Number(line.qty),
    nextQty,
    periodStart: new Date(invoice.period_start),
    periodEnd: new Date(invoice.period_end),
    changedAt: new Date(),
  });

  if (amount === 0) {
    return { invoiceId, amount: 0, creditNoteId: null, newInvoiceId: null };
  }

  // A downgrade credits, an upgrade charges. Same maths, opposite documents.
  if (amount < 0) {
    const { data: note, error: noteError } = await supabase
      .from("credit_notes")
      .insert({
        invoice_id: invoiceId,
        order_id: invoice.order_id,
        amount: Math.abs(amount),
        reason: nextQty === 0 ? "cancellation" : reason,
        note: `Quantity ${line.qty} → ${nextQty} mid-cycle`,
        created_by: actorId,
      })
      .select("id")
      .single<{ id: string }>();

    if (noteError) return { error: noteError.message, status: 500 };

    return { invoiceId, amount, creditNoteId: note.id, newInvoiceId: null };
  }

  const created = await writeInvoice(supabase, {
    orderId: invoice.order_id,
    reference: null,
    kind: "recurring",
    periodStart: new Date(invoice.period_start),
    periodEnd: new Date(invoice.period_end),
    dueDate: new Date(),
    lines: [
      {
        productId: line.product_id ?? "",
        productName: `${line.description} (mid-cycle increase)`,
        qty: nextQty - Number(line.qty),
        unitPrice: Number(line.unit_price),
        discountPct: 0,
        cadence: "monthly",
        net: amount,
      },
    ],
    overrideTotal: amount,
  });

  if ("error" in created) return { error: created.error, status: 500 };

  return { invoiceId, amount, creditNoteId: null, newInvoiceId: created.id };
}

/* ------------------------------------------------------------------ *
 * Writing invoices
 * ------------------------------------------------------------------ */

async function writeInvoice(
  supabase: Supabase,
  input: {
    orderId: string;
    reference: string | null;
    kind: "one_time" | "recurring";
    lines: OrderLine[];
    periodStart?: Date;
    periodEnd?: Date;
    dueDate: Date;
    /** Used when the amount is a proration rather than the sum of the lines. */
    overrideTotal?: number;
  },
): Promise<{ id: string } | { error: string }> {
  const amount = input.overrideTotal ?? total(input.lines);

  const { data, error } = await supabase
    .from("invoices")
    .insert({
      order_id: input.orderId,
      reference: input.reference,
      kind: input.kind,
      period_start: input.periodStart ? isoDate(input.periodStart) : null,
      period_end: input.periodEnd ? isoDate(input.periodEnd) : null,
      due_date: isoDate(input.dueDate),
      total: amount,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !data) {
    return { error: error?.message ?? "Could not write the invoice" };
  }

  const { error: lineError } = await supabase.from("invoice_lines").insert(
    input.lines.map((line) => ({
      invoice_id: data.id,
      product_id: line.productId || null,
      description: line.productName,
      qty: line.qty,
      unit_price: line.unitPrice,
      amount: line.net,
    })),
  );

  return lineError ? { error: lineError.message } : { id: data.id };
}

/** The first billing period for a cadence, starting at the order's anchor. */
function firstPeriod(cadence: BillingCadence, anchor: Date) {
  const start = startOfDay(anchor);
  const months = CADENCE_MONTHS[cadence];

  const end =
    nextBillingDate(
      { id: "", name: "", cadence, qty: 1, unitPrice: 0, anchor: start },
      start,
    ) ?? addMonths(start, months || 1);

  return { start, end };
}

/** QT-1234 becomes ORD-1234; anything else falls back to the id. */
function orderReference(quotation: { id: string; reference: string | null }): string {
  const base = quotation.reference ?? quotation.id.slice(0, 8);
  return base.startsWith("ORD-") ? base : `ORD-${base.replace(/^Q[A-Z]*-/i, "")}`;
}

function total(lines: OrderLine[]): number {
  return round2(lines.reduce((sum, line) => sum + line.net, 0));
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const next = startOfDay(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date: Date, months: number): Date {
  const next = startOfDay(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

/** A date column wants a calendar day, not an instant in UTC. */
function isoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase-server";

/** Reading the billing ledger, for the screens that render it. */

export type InvoiceRow = {
  id: string;
  reference: string | null;
  kind: "one_time" | "recurring";
  periodStart: string | null;
  periodEnd: string | null;
  dueDate: string | null;
  total: number;
  amountPaid: number;
  status: string;
  orderReference: string | null;
  customerName: string;
  quotationId: string | null;
  lines: { id: string; description: string; qty: number; unitPrice: number }[];
};

export type LedgerData = {
  invoices: InvoiceRow[];
  creditNotes: {
    id: string;
    amount: number;
    reason: string;
    note: string | null;
    createdAt: string;
    orderReference: string | null;
  }[];
  /** Billed, collected, and what is still owed. */
  totals: { billed: number; collected: number; outstanding: number; credited: number };
  error: string | null;
};

type RawInvoice = {
  id: string;
  reference: string | null;
  kind: "one_time" | "recurring";
  period_start: string | null;
  period_end: string | null;
  due_date: string | null;
  total: number;
  amount_paid: number;
  status: string;
  orders: {
    reference: string | null;
    quotation_id: string | null;
    customers: { name: string | null } | null;
  } | null;
  invoice_lines: {
    id: string;
    description: string;
    qty: number;
    unit_price: number;
  }[];
};

export async function loadLedger(orderId?: string): Promise<LedgerData> {
  const supabase = createServerSupabaseClient();

  let invoiceQuery = supabase
    .from("invoices")
    .select(
      `id, reference, kind, period_start, period_end, due_date, total, amount_paid,
       status, issued_at,
       orders(reference, quotation_id, customers(name)),
       invoice_lines(id, description, qty, unit_price)`,
    )
    .order("issued_at", { ascending: false })
    .limit(200);

  let creditQuery = supabase
    .from("credit_notes")
    .select("id, amount, reason, note, created_at, orders(reference)")
    .order("created_at", { ascending: false })
    .limit(50);

  if (orderId) {
    invoiceQuery = invoiceQuery.eq("order_id", orderId);
    creditQuery = creditQuery.eq("order_id", orderId);
  }

  const [invoiceResult, creditResult] = await Promise.all([
    invoiceQuery.returns<RawInvoice[]>(),
    creditQuery.returns<
      {
        id: string;
        amount: number;
        reason: string;
        note: string | null;
        created_at: string;
        orders: { reference: string | null } | null;
      }[]
    >(),
  ]);

  const failure = invoiceResult.error ?? creditResult.error;

  const invoices: InvoiceRow[] = (invoiceResult.data ?? []).map((row) => ({
    id: row.id,
    reference: row.reference,
    kind: row.kind,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    dueDate: row.due_date,
    total: Number(row.total),
    amountPaid: Number(row.amount_paid),
    status: row.status,
    orderReference: row.orders?.reference ?? null,
    customerName: row.orders?.customers?.name ?? "Unassigned customer",
    quotationId: row.orders?.quotation_id ?? null,
    lines: (row.invoice_lines ?? []).map((line) => ({
      id: line.id,
      description: line.description,
      qty: Number(line.qty),
      unitPrice: Number(line.unit_price),
    })),
  }));

  const creditNotes = (creditResult.data ?? []).map((row) => ({
    id: row.id,
    amount: Number(row.amount),
    reason: row.reason,
    note: row.note,
    createdAt: row.created_at,
    orderReference: row.orders?.reference ?? null,
  }));

  // A voided invoice is not billed revenue, so it is left out of every total
  // rather than netted off — netting would show a figure that matches nothing on
  // any document.
  const live = invoices.filter((invoice) => invoice.status !== "void");
  const billed = sum(live.map((invoice) => invoice.total));
  const collected = sum(live.map((invoice) => invoice.amountPaid));

  return {
    invoices,
    creditNotes,
    totals: {
      billed: round2(billed),
      collected: round2(collected),
      outstanding: round2(Math.max(0, billed - collected)),
      credited: round2(sum(creditNotes.map((note) => note.amount))),
    },
    error: failure?.message ?? null,
  };
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

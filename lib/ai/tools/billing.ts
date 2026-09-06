import "server-only";
import { loadLedger, type InvoiceRow } from "@/lib/invoices-server";
import { formatCurrency } from "@/lib/quotations";
import { registerTool } from "../tool-registry";
import type { ChatTool } from "../types";

/**
 * The billing ledger — invoices, what is outstanding, and credit notes.
 *
 * Gated on `billing`, which is view for a rep or manager and write for finance.
 * The assistant is read-only either way: nobody records a payment by asking.
 */

/**
 * Where one invoice stands, in the words somebody asking about money uses.
 *
 * Deliberately not `invoiceStage` from business-logic: that one answers "how far
 * has this order travelled" from the allocation, which the ledger query does not
 * carry. The question here is only ever whether we have been paid.
 */
type Settlement = "Paid" | "Overdue" | "Part paid" | "Unpaid";

function settlementOf(invoice: InvoiceRow, now: Date): Settlement {
  if (invoice.total > 0 && invoice.amountPaid >= invoice.total) return "Paid";

  const due = invoice.dueDate ? new Date(invoice.dueDate) : null;
  if (due && !Number.isNaN(due.getTime()) && due < now) return "Overdue";

  return invoice.amountPaid > 0 ? "Part paid" : "Unpaid";
}

const billingPosition: ChatTool = {
  id: "billing_position",
  description:
    "The billing ledger: total billed, collected and outstanding, plus the invoices behind " +
    "it. Use for questions about money owed, overdue invoices, or payment status.",
  module: "billing",
  minimum: "view",
  parameters: {
    type: "object",
    properties: {
      onlyOutstanding: {
        type: "boolean",
        description: "Return only invoices that are not fully paid. Defaults to true.",
      },
      customer: { type: "string", description: "Partial match on the customer's name." },
      limit: { type: "integer", description: "How many invoices to return (default 10, max 25)." },
    },
  },
  execute: async (args) => {
    const { invoices, totals, creditNotes, error } = await loadLedger();
    if (error) return { error: "Could not read the billing ledger." };

    const onlyOutstanding = args.onlyOutstanding !== false;
    const needle = typeof args.customer === "string" ? args.customer.trim().toLowerCase() : "";

    const now = new Date();
    const withStage = invoices.map((invoice) => ({
      invoice,
      stage: settlementOf(invoice, now),
    }));

    const matched = withStage.filter((row) => {
      if (onlyOutstanding && row.stage === "Paid") return false;
      if (needle && !row.invoice.customerName.toLowerCase().includes(needle)) return false;
      return true;
    });

    const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 25);

    return {
      totals: {
        billed: formatCurrency(totals.billed),
        collected: formatCurrency(totals.collected),
        outstanding: formatCurrency(totals.outstanding),
        credited: formatCurrency(totals.credited),
      },
      creditNoteCount: creditNotes.length,
      matched: matched.length,
      invoices: matched.slice(0, limit).map(({ invoice, stage }) => ({
        reference: invoice.reference ?? invoice.id.slice(0, 8),
        customer: invoice.customerName,
        order: invoice.orderReference,
        kind: invoice.kind === "recurring" ? "Subscription" : "One-time",
        stage,
        total: formatCurrency(invoice.total),
        paid: formatCurrency(invoice.amountPaid),
        outstanding: formatCurrency(invoice.total - invoice.amountPaid),
        dueDate: invoice.dueDate,
        page: `/invoices/${invoice.id}`,
      })),
    };
  },
};

registerTool(billingPosition);

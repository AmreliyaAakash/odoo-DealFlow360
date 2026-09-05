"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ReceiptIcon } from "@phosphor-icons/react";
import type { InvoiceRow } from "@/lib/invoices-server";
import { formatCurrency } from "@/lib/quotations";
import { cn } from "@/lib/utils";
import {
  DataTable,
  EmptyRow,
  Notice,
  Panel,
  PanelHeader,
  Td,
  Th,
  Tr,
} from "@/components/dashboard/panel";

/**
 * B7 — the ledger, and the two things finance does to it.
 *
 * Recording a payment and changing a subscription sit on the rows themselves
 * rather than behind a detail page: both are single-number decisions, and making
 * someone navigate to make one is how a reconciliation session turns into an
 * afternoon.
 */
export function InvoiceTable({
  invoices,
  canWrite,
}: {
  invoices: InvoiceRow[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post(invoiceId: string, body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/invoices/${invoiceId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();

      if (!response.ok) {
        setError(payload.error ?? "That did not go through");
        return;
      }

      setOpen(null);
      setAmount("");
      router.refresh();
    } catch {
      setError("Could not reach the billing service");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel delay={120}>
      <PanelHeader
        icon={ReceiptIcon}
        title="Invoices"
        caption="One-time and recurring, billed separately"
      />

      {error ? (
        <div className="mt-3">
          <Notice tone="danger">{error}</Notice>
        </div>
      ) : null}

      <div className="mt-3">
        <DataTable
          minWidth="56rem"
          head={
            <>
              <Th>Invoice</Th>
              <Th>Customer</Th>
              <Th className="w-28">Kind</Th>
              <Th className="w-32">Period</Th>
              <Th className="w-28 text-right">Total</Th>
              <Th className="w-28 text-right">Outstanding</Th>
              <Th className="w-24">Status</Th>
              <Th className="w-44" />
            </>
          }
        >
          {invoices.map((invoice, index) => {
            const outstanding = Math.max(0, invoice.total - invoice.amountPaid);
            const settled = invoice.status === "paid" || invoice.status === "void";

            return (
              <Tr
                key={invoice.id}
                className="df-rise-in"
                style={{ "--df-delay": `${index * 30}ms` } as React.CSSProperties}
              >
                <Td className="font-medium">
                  {invoice.quotationId ? (
                    <Link
                      href={`/quotations/${invoice.quotationId}`}
                      className="hover:text-indigo-600 dark:hover:text-indigo-400"
                    >
                      {invoice.reference ?? invoice.id.slice(0, 8)}
                    </Link>
                  ) : (
                    (invoice.reference ?? invoice.id.slice(0, 8))
                  )}
                </Td>
                <Td className="text-muted-foreground">{invoice.customerName}</Td>
                <Td>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-medium",
                      invoice.kind === "recurring"
                        ? "bg-indigo-500/10 text-indigo-600 dark:text-indigo-300"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {invoice.kind === "recurring" ? "Subscription" : "One-time"}
                  </span>
                </Td>
                <Td className="text-[11px] text-muted-foreground">
                  {invoice.periodStart
                    ? `${invoice.periodStart} → ${invoice.periodEnd}`
                    : (invoice.dueDate ?? "—")}
                </Td>
                <Td className="text-right font-medium tabular-nums">
                  {formatCurrency(invoice.total)}
                </Td>
                <Td className="text-right tabular-nums">
                  {outstanding === 0 ? "—" : formatCurrency(outstanding)}
                </Td>
                <Td>
                  <StatusPill status={invoice.status} />
                </Td>
                <Td>
                  {!canWrite ? null : open === invoice.id ? (
                    <span className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        autoFocus
                        value={amount}
                        onChange={(event) => setAmount(event.target.value)}
                        placeholder={String(outstanding)}
                        className="h-7 w-24 rounded-lg bg-muted px-2 text-right text-[11px] tabular-nums outline-none ring-1 ring-transparent focus:ring-indigo-500/40"
                      />
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void post(invoice.id, {
                            amount: Number(amount === "" ? outstanding : amount),
                          })
                        }
                        className="rounded-lg bg-emerald-500 px-2 py-1 text-[11px] font-medium text-white transition-colors hover:bg-emerald-400 disabled:opacity-50"
                      >
                        {busy ? "…" : "Record"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setOpen(null)}
                        className="rounded-lg px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-muted"
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <span className="flex gap-1">
                      {settled ? null : (
                        <button
                          type="button"
                          onClick={() => {
                            setOpen(invoice.id);
                            setAmount("");
                          }}
                          className="rounded-lg bg-muted px-2 py-1 text-[11px] font-medium transition-colors hover:bg-muted/70"
                        >
                          Record payment
                        </button>
                      )}
                      {invoice.kind === "recurring" ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void post(invoice.id, {
                              action: "change_quantity",
                              qty: 0,
                            })
                          }
                          title="Cancels the subscription and raises a credit note for the unused days"
                          className="rounded-lg px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      ) : null}
                    </span>
                  )}
                </Td>
              </Tr>
            );
          })}

          {invoices.length === 0 ? (
            <EmptyRow colSpan={8}>
              Nothing billed yet. Raise an order from a confirmed quotation.
            </EmptyRow>
          ) : null}
        </DataTable>
      </div>
    </Panel>
  );
}

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-medium capitalize",
        status === "paid" && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
        status === "part_paid" && "bg-amber-500/10 text-amber-600 dark:text-amber-400",
        status === "issued" && "bg-muted text-muted-foreground",
        status === "void" && "bg-red-500/10 text-red-600 dark:text-red-400",
      )}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

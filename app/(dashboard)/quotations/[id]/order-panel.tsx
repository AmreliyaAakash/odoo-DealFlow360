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
 * B7 — the billing side of a confirmed quotation.
 *
 * Before the order exists this is a single button; afterwards it is the invoices
 * that came out of it, one-time and recurring shown apart. Keeping both states
 * in one panel means the deal page always answers "has this been billed?" in the
 * same place, rather than the answer appearing somewhere new once it is yes.
 */
export function OrderPanel({
  quotationId,
  order,
  invoices,
  canRaise,
}: {
  quotationId: string;
  order: { id: string; reference: string | null; status: string } | null;
  invoices: InvoiceRow[];
  /** False for a rep: billing is finance's to start. */
  canRaise: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function raise() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quotationId }),
      });
      const body = await response.json();

      if (!response.ok) {
        setError(body.error ?? "Could not raise the order");
        return;
      }

      router.refresh();
    } catch {
      setError("Could not reach the billing service");
    } finally {
      setBusy(false);
    }
  }

  const oneTime = invoices.filter((invoice) => invoice.kind === "one_time");
  const recurring = invoices.filter((invoice) => invoice.kind === "recurring");

  return (
    <Panel>
      <PanelHeader
        icon={ReceiptIcon}
        title={order ? `Order ${order.reference ?? ""}`.trim() : "Order and billing"}
        caption={
          order
            ? `${oneTime.length} one-time · ${recurring.length} recurring invoice(s)`
            : "This quotation is confirmed and has not been ordered yet"
        }
      >
        {!order && canRaise ? (
          <button
            type="button"
            onClick={() => void raise()}
            disabled={busy}
            className="rounded-lg bg-zinc-900 px-2.5 py-1.5 text-[11px] font-medium text-zinc-50 transition-colors hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            {busy ? "Raising..." : "Raise order"}
          </button>
        ) : null}

        {order ? (
          <Link
            href="/finance/billing"
            className="rounded-lg bg-muted px-2.5 py-1.5 text-[11px] font-medium transition-colors hover:bg-muted/70"
          >
            Open in billing
          </Link>
        ) : null}
      </PanelHeader>

      {error ? (
        <div className="mt-3">
          <Notice tone="danger">{error}</Notice>
        </div>
      ) : null}

      {order ? (
        <div className="mt-3">
          <DataTable
            minWidth="42rem"
            head={
              <>
                <Th>Invoice</Th>
                <Th className="w-28">Kind</Th>
                <Th className="w-40">Covers</Th>
                <Th className="w-28 text-right">Total</Th>
                <Th className="w-28 text-right">Paid</Th>
                <Th className="w-24">Status</Th>
              </>
            }
          >
            {invoices.map((invoice, index) => (
              <Tr
                key={invoice.id}
                className="df-rise-in"
                style={{ "--df-delay": `${index * 40}ms` } as React.CSSProperties}
              >
                <Td className="font-medium">
                  {invoice.reference ?? invoice.id.slice(0, 8)}
                </Td>
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
                    : `Due ${invoice.dueDate ?? "—"}`}
                </Td>
                <Td className="text-right font-medium tabular-nums">
                  {formatCurrency(invoice.total)}
                </Td>
                <Td className="text-right tabular-nums text-muted-foreground">
                  {formatCurrency(invoice.amountPaid)}
                </Td>
                <Td className="text-[11px] capitalize text-muted-foreground">
                  {invoice.status.replace(/_/g, " ")}
                </Td>
              </Tr>
            ))}

            {invoices.length === 0 ? (
              <EmptyRow colSpan={6}>This order has no invoices.</EmptyRow>
            ) : null}
          </DataTable>
        </div>
      ) : null}
    </Panel>
  );
}

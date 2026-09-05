import Link from "next/link";
import { CurrencyInrIcon } from "@phosphor-icons/react/dist/ssr";
import { loadLedger } from "@/lib/invoices-server";
import { requireModule } from "@/lib/page-guard";
import { formatCurrency } from "@/lib/quotations";
import { cn } from "@/lib/utils";
import {
  DataTable,
  EmptyRow,
  Notice,
  PageHeader,
  Panel,
  PanelHeader,
  Td,
  Th,
  Tr,
} from "@/components/dashboard/panel";

/**
 * Screen 12 — every invoice, one row each, click through to the detail.
 *
 * Its own tab rather than a panel inside billing: an invoice is a document the
 * desk chases by number, and a screen that can only be reached by first picking
 * a subscription is no use to somebody holding a remittance advice.
 */
export default async function InvoicesPage() {
  await requireModule("billing");

  const ledger = await loadLedger();
  const unpaid = ledger.invoices.filter(
    (invoice) => invoice.status === "issued" || invoice.status === "part_paid",
  );
  const paid = ledger.invoices.filter((invoice) => invoice.status === "paid");

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4">
      <PageHeader
        title="Invoices"
        caption={`${formatCurrency(ledger.totals.billed)} billed · ${formatCurrency(
          ledger.totals.outstanding,
        )} outstanding`}
        badge="Billing"
      />

      {ledger.error ? <Notice tone="danger">{ledger.error}</Notice> : null}

      <div className="flex flex-wrap gap-2">
        <Count tone="danger" label={`${unpaid.length} Unpaid`} />
        <Count tone="ok" label={`${paid.length} Paid`} />
        <Count
          tone="muted"
          label={`${formatCurrency(ledger.totals.credited)} credited`}
        />
      </div>

      <Panel delay={80}>
        <PanelHeader
          icon={CurrencyInrIcon}
          title="All invoices"
          caption="One-time and recurring, newest first"
        />

        <div className="mt-3">
          <DataTable
            minWidth="46rem"
            head={
              <>
                <Th>Invoice #</Th>
                <Th>Customer</Th>
                <Th className="w-28">Kind</Th>
                <Th className="w-28 text-right">Amount</Th>
                <Th className="w-24">Status</Th>
                <Th className="w-28">Due date</Th>
              </>
            }
          >
            {ledger.invoices.map((invoice, index) => (
              <Tr
                key={invoice.id}
                className="df-rise-in"
                style={{ "--df-delay": `${Math.min(index * 30, 400)}ms` } as React.CSSProperties}
              >
                <Td className="font-medium">
                  <Link
                    href={`/invoices/${invoice.id}`}
                    className="hover:text-indigo-600 dark:hover:text-indigo-400"
                  >
                    {invoice.reference ?? invoice.id.slice(0, 8)}
                  </Link>
                </Td>
                <Td>{invoice.customerName}</Td>
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
                <Td className="text-right font-medium tabular-nums">
                  {formatCurrency(invoice.total)}
                </Td>
                <Td className="text-[11px] capitalize text-muted-foreground">
                  {invoice.status.replace(/_/g, " ")}
                </Td>
                <Td className="text-muted-foreground">{invoice.dueDate ?? "—"}</Td>
              </Tr>
            ))}

            {ledger.invoices.length === 0 ? (
              <EmptyRow colSpan={6}>
                Nothing billed yet. Raise an order from a confirmed quotation.
              </EmptyRow>
            ) : null}
          </DataTable>
        </div>
      </Panel>
    </main>
  );
}

function Count({
  tone,
  label,
}: {
  tone: "ok" | "danger" | "muted";
  label: string;
}) {
  return (
    <span
      className={cn(
        "rounded-lg px-3 py-1.5 text-xs font-medium",
        tone === "ok" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        tone === "danger" && "bg-red-500/10 text-red-700 dark:text-red-400",
        tone === "muted" && "bg-muted text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}

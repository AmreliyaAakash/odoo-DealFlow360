import Link from "next/link";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/ssr";
import { formatCurrency } from "@/lib/quotations";
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
import { currentUser } from "@/lib/auth";
import { loadLedger } from "@/lib/invoices-server";
import { canWith, effectiveAccess } from "@/lib/permissions-server";
import { loadFinanceDashboard } from "../data";
import { requireFinance } from "../guard";
import { InvoiceTable } from "../invoice-table";
import { MrrChart } from "../mrr-chart";

/** Subscriptions and their upcoming bill dates. */
export default async function BillingPage() {
  await requireFinance();

  const { userId, role } = await currentUser();
  const { access } = await effectiveAccess(userId ?? "", role);
  const canWrite = canWith(access, "billing", "write");

  const [data, ledger] = await Promise.all([loadFinanceDashboard(), loadLedger()]);
  const subscriptions = data.queue.filter((row) => row.kind === "subscription");

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4">
      <PageHeader
        title="Subscriptions & Billing"
        caption={`${subscriptions.length} active · ${formatCurrency(data.stats.mrr)} MRR · ${formatCurrency(ledger.totals.outstanding)} outstanding`}
        badge="Recurring"
      />

      {data.loadError ? (
        <Notice>Could not load billing data: {data.loadError}</Notice>
      ) : null}
      {ledger.error ? (
        <Notice>Could not load the ledger: {ledger.error}</Notice>
      ) : null}

      <MrrChart data={data.mrrTrend} />

      <InvoiceTable invoices={ledger.invoices} canWrite={canWrite} />

      <Panel delay={120}>
        <PanelHeader
          icon={ArrowsClockwiseIcon}
          title="Active subscriptions"
          caption="Sorted by contract value"
        />

        <div className="mt-3">
          <DataTable
            minWidth="44rem"
            head={
              <>
                <Th>Quote</Th>
                <Th>Customer</Th>
                <Th className="w-36">Next bill date</Th>
                <Th className="w-32 text-right">Monthly</Th>
                <Th className="w-32 text-right">Contract value</Th>
              </>
            }
          >
            {subscriptions.map((row, index) => (
              <Tr
                key={row.id}
                className="df-rise-in"
                style={{ "--df-delay": `${Math.min(index * 35, 400)}ms` } as React.CSSProperties}
              >
                <Td className="font-medium">
                  <Link
                    href={`/quotations/${row.id}`}
                    className="hover:text-emerald-700 dark:hover:text-emerald-400"
                  >
                    {row.reference}
                  </Link>
                </Td>
                <Td>{row.customer}</Td>
                <Td className="text-muted-foreground">
                  {row.nextBillDate
                    ? new Date(row.nextBillDate).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })
                    : "—"}
                </Td>
                <Td className="text-right font-medium tabular-nums">
                  {formatCurrency(row.mrr)}
                </Td>
                <Td className="text-right tabular-nums text-muted-foreground">
                  {formatCurrency(row.amount)}
                </Td>
              </Tr>
            ))}

            {subscriptions.length === 0 ? (
              <EmptyRow colSpan={5}>No active subscriptions.</EmptyRow>
            ) : null}
          </DataTable>
        </div>
      </Panel>
    </main>
  );
}

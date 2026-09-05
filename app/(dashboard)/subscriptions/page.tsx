import Link from "next/link";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/ssr";
import { CADENCE_MONTHS } from "@/lib/business-logic";
import { requireModule } from "@/lib/page-guard";
import { formatCurrency } from "@/lib/quotations";
import { loadSubscriptions } from "@/lib/subscriptions-server";
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
 * Screen 9 — every recurring plan across every customer, whichever order it
 * came from. Rows open the billing detail.
 */
export default async function SubscriptionsPage() {
  const actor = await requireModule("billing");
  const book = await loadSubscriptions();

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4">
      <PageHeader
        title="Subscriptions"
        caption={`${book.counts.active} active · ${formatCurrency(book.mrr)} MRR`}
        badge="Recurring"
      >
        {actor.can("subscriptionPlans", "write") ? (
          <Link
            href="/backend/subscriptions"
            className="flex h-8 items-center rounded-lg bg-muted px-3 text-xs font-medium transition-colors hover:bg-muted/70"
          >
            + New plan
          </Link>
        ) : null}
      </PageHeader>

      {book.error ? <Notice tone="danger">{book.error}</Notice> : null}

      <div className="flex flex-wrap gap-2">
        <Count tone="ok" label={`${book.counts.active} Active`} />
        <Count tone="warn" label={`${book.counts.paused} Paused`} />
        <Count tone="danger" label={`${book.counts.cancelled} Cancelled`} />
      </div>

      <Panel delay={80}>
        <PanelHeader
          icon={ArrowsClockwiseIcon}
          title="All subscriptions"
          caption="Newest first"
        />

        <div className="mt-3">
          <DataTable
            minWidth="48rem"
            head={
              <>
                <Th>Customer</Th>
                <Th>Plan</Th>
                <Th className="w-28">Cycle</Th>
                <Th className="w-32">Next bill</Th>
                <Th className="w-28 text-right">Monthly</Th>
                <Th className="w-24">Status</Th>
              </>
            }
          >
            {book.subscriptions.map((row, index) => (
              <Tr
                key={row.id}
                className="df-rise-in"
                style={{ "--df-delay": `${Math.min(index * 30, 400)}ms` } as React.CSSProperties}
              >
                <Td className="font-medium">
                  <Link
                    href={`/subscriptions/${row.id}`}
                    className="hover:text-indigo-600 dark:hover:text-indigo-400"
                  >
                    {row.customerName}
                  </Link>
                </Td>
                <Td>{row.planName ?? row.productName}</Td>
                <Td className="capitalize text-muted-foreground">
                  {row.cadence} ({CADENCE_MONTHS[row.cadence]}m)
                </Td>
                <Td className="text-muted-foreground">{row.nextBillOn ?? "—"}</Td>
                <Td className="text-right font-medium tabular-nums">
                  {formatCurrency(row.mrr)}
                </Td>
                <Td>
                  <StatusPill status={row.status} />
                </Td>
              </Tr>
            ))}

            {book.subscriptions.length === 0 ? (
              <EmptyRow colSpan={6}>
                No subscriptions yet. They are raised when an order with a
                recurring line is confirmed.
              </EmptyRow>
            ) : null}
          </DataTable>
        </div>
      </Panel>
    </main>
  );
}

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-medium capitalize",
        status === "active" && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
        status === "paused" && "bg-amber-500/10 text-amber-600 dark:text-amber-400",
        status === "cancelled" && "bg-red-500/10 text-red-600 dark:text-red-400",
      )}
    >
      {status}
    </span>
  );
}

function Count({
  tone,
  label,
}: {
  tone: "ok" | "warn" | "danger";
  label: string;
}) {
  return (
    <span
      className={cn(
        "rounded-lg px-3 py-1.5 text-xs font-medium",
        tone === "ok" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        tone === "warn" && "bg-amber-500/10 text-amber-700 dark:text-amber-400",
        tone === "danger" && "bg-red-500/10 text-red-700 dark:text-red-400",
      )}
    >
      {label}
    </span>
  );
}

import Link from "next/link";
import { PlusIcon, ReceiptIcon } from "@phosphor-icons/react/dist/ssr";
import { formatCurrency } from "@/lib/quotations";
import { QUOTATION_STATUSES, statusColor, statusLabel } from "@/lib/status";
import {
  DataTable,
  EmptyRow,
  PageHeader,
  Panel,
  PanelHeader,
  Td,
  Th,
  Tr,
} from "@/components/dashboard/panel";
import { StatusBadge } from "@/components/dashboard/status-badge";

/** B2 — quotation list / pipeline. STRUCTURE ONLY: rows are not fetched yet. */

type PipelineQuotation = {
  id: string;
  reference: string | null;
  customer: string | null;
  status: string | null;
  netTotal: number;
  updatedAt: string | null;
};

/** Pipeline columns, in the order deals move through them. */
const STAGES = ["draft", "pending_approval", "approved", "won", "lost"] as const;

export default async function QuotationsPage() {
  // TODO(B2): GET /api/quotations (optionally ?repId=) or query Supabase directly.
  const quotations: PipelineQuotation[] = [];

  const totalValue = quotations.reduce((sum, q) => sum + q.netTotal, 0);

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4">
      <PageHeader
        title="Quotations"
        caption={`${quotations.length} in the pipeline · ${formatCurrency(totalValue)}`}
        badge="Pipeline"
      >
        {/* TODO(B2): POST /api/quotations, then route to the new quote. */}
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-50 transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          <PlusIcon size={13} weight="bold" />
          New quotation
        </button>
      </PageHeader>

      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {STAGES.map((stage, index) => {
          const inStage = quotations.filter((q) => q.status === stage);
          const value = inStage.reduce((sum, q) => sum + q.netTotal, 0);

          return (
            <Panel key={stage} delay={index * 60} className="p-3">
              <div className="flex items-center gap-1.5">
                <span
                  className="size-2 rounded-full"
                  style={{ background: statusColor(stage) }}
                />
                <p className="truncate text-[11px] font-medium capitalize">
                  {statusLabel(stage)}
                </p>
              </div>
              <p className="mt-2 text-xl font-semibold tabular-nums">
                {inStage.length}
              </p>
              <p className="text-[11px] tabular-nums text-muted-foreground">
                {formatCurrency(value)}
              </p>
            </Panel>
          );
        })}
      </div>

      <Panel delay={320}>
        <PanelHeader
          icon={ReceiptIcon}
          title="All quotations"
          caption={`${QUOTATION_STATUSES.length} statuses tracked`}
        />

        <div className="mt-3">
          <DataTable
            minWidth="38rem"
            head={
              <>
                <Th>Reference</Th>
                <Th>Customer</Th>
                <Th className="w-36">Status</Th>
                <Th className="w-28 text-right">Value</Th>
                <Th className="w-28">Updated</Th>
              </>
            }
          >
            {quotations.map((quotation) => (
              <Tr key={quotation.id}>
                <Td className="font-medium">
                  <Link
                    href={`/quotations/${quotation.id}`}
                    className="hover:text-indigo-600 dark:hover:text-indigo-400"
                  >
                    {quotation.reference ?? quotation.id}
                  </Link>
                </Td>
                <Td>{quotation.customer ?? "—"}</Td>
                <Td>
                  <StatusBadge status={quotation.status ?? "draft"} />
                </Td>
                <Td className="text-right font-medium tabular-nums">
                  {formatCurrency(quotation.netTotal)}
                </Td>
                <Td className="text-muted-foreground">{quotation.updatedAt ?? "—"}</Td>
              </Tr>
            ))}

            {quotations.length === 0 ? (
              <EmptyRow colSpan={5}>No quotations yet.</EmptyRow>
            ) : null}
          </DataTable>
        </div>
      </Panel>
    </main>
  );
}

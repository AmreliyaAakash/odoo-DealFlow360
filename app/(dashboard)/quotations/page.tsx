import Link from "next/link";
import { redirect } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { PlusIcon, ReceiptIcon } from "@phosphor-icons/react/dist/ssr";
import { currentUser } from "@/lib/auth";
import { canWith, effectiveAccess, scopeWith } from "@/lib/permissions-server";
import { formatCurrency } from "@/lib/quotations";
import { statusColor, statusLabel } from "@/lib/status";
import { createServerSupabaseClient } from "@/lib/supabase-server";
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
import { StatusBadge } from "@/components/dashboard/status-badge";

/** B2 — quotation list / pipeline. */

type PipelineRow = {
  id: string;
  reference: string | null;
  status: string | null;
  net_total: number | null;
  updated_at: string | null;
  customers: { name: string | null } | null;
};

/** Pipeline columns, in the order deals move through them. */
const STAGES = ["draft", "pending_approval", "approved", "won", "lost"] as const;

export default async function QuotationsPage() {
  const { userId, role } = await currentUser();
  if (!userId) redirect("/sign-in");

  const { access } = await effectiveAccess(userId, role);
  if (!canWith(access, "quotationBuilder", "view")) redirect("/unauthorized");

  const scope = scopeWith(access, "quotationBuilder");
  const canCreate = canWith(access, "quotationBuilder", "write");

  const supabase = createServerSupabaseClient();

  let pipelineQuery = supabase
    .from("quotations")
    .select("id, reference, status, net_total, updated_at, customers(name)")
    .order("updated_at", { ascending: false });

  // A rep sees their own pipeline only — the same rule `GET /api/quotations`
  // applies, kept here so the page and the endpoint cannot disagree.
  if (scope === "own") pipelineQuery = pipelineQuery.eq("rep_id", userId);

  const pipelineResult = await pipelineQuery.returns<PipelineRow[]>();

  const quotations = pipelineResult.data ?? [];
  const error = pipelineResult.error?.message ?? null;
  const totalValue = quotations.reduce((sum, q) => sum + (q.net_total ?? 0), 0);

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4">
      <PageHeader
        title="Quotations"
        caption={`${quotations.length} in the pipeline · ${formatCurrency(totalValue)}`}
        badge="Pipeline"
      >
        {canCreate ? (
          <Link
            href="/quotations/new"
            className="flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-50 transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            <PlusIcon size={13} weight="bold" />
            New quotation
          </Link>
        ) : null}
      </PageHeader>

      {error ? <Notice tone="danger">{error}</Notice> : null}

      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {STAGES.map((stage, index) => {
          const inStage = quotations.filter((q) => q.status === stage);
          const value = inStage.reduce((sum, q) => sum + (q.net_total ?? 0), 0);

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
          caption={
            scope === "own"
              ? "Your quotations"
              : scope === "team"
                ? "Your team's quotations"
                : "Every quotation"
          }
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
                    {quotation.reference ?? quotation.id.slice(0, 8)}
                  </Link>
                </Td>
                <Td>{quotation.customers?.name ?? "—"}</Td>
                <Td>
                  <StatusBadge status={quotation.status ?? "draft"} />
                </Td>
                <Td className="text-right font-medium tabular-nums">
                  {formatCurrency(quotation.net_total ?? 0)}
                </Td>
                <Td className="text-muted-foreground">
                  {quotation.updated_at
                    ? formatDistanceToNow(new Date(quotation.updated_at), {
                        addSuffix: true,
                      })
                    : "—"}
                </Td>
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

import Link from "next/link";
import { redirect } from "next/navigation";
import { PlusIcon } from "@phosphor-icons/react/dist/ssr";
import { currentUser } from "@/lib/auth";
import { canWith, effectiveAccess, scopeWith } from "@/lib/permissions-server";
import { formatCurrency } from "@/lib/quotations";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { Notice, PageHeader } from "@/components/dashboard/panel";
import { QuotationsView, type PipelineDeal } from "./quotations-view";

/** B2 / screen 3 — quotation list, as a stage board or a table. */

type PipelineRow = {
  id: string;
  reference: string | null;
  status: string | null;
  net_total: number | null;
  updated_at: string | null;
  customers: { name: string | null } | null;
};

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

  const rows = pipelineResult.data ?? [];
  const error = pipelineResult.error?.message ?? null;
  const totalValue = rows.reduce((sum, row) => sum + (row.net_total ?? 0), 0);

  const deals: PipelineDeal[] = rows.map((row) => ({
    id: row.id,
    reference: row.reference ?? row.id.slice(0, 8),
    customer: row.customers?.name ?? "—",
    status: row.status ?? "draft",
    value: Number(row.net_total ?? 0),
    updatedAt: row.updated_at,
  }));

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4">
      <PageHeader
        title="Quotations"
        caption={`${deals.length} in the pipeline · ${formatCurrency(totalValue)}`}
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

      <QuotationsView
        deals={deals}
        caption={
          scope === "own"
            ? "Your quotations"
            : scope === "team"
              ? "Your team's quotations"
              : "Every quotation"
        }
      />
    </main>
  );
}

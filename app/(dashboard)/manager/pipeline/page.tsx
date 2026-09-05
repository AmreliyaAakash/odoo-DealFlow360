import { redirect } from "next/navigation";
import Link from "next/link";
import { BriefcaseIcon } from "@phosphor-icons/react/dist/ssr";
import { riskScoreFromTotals } from "@/lib/business-logic";
import { formatCurrency } from "@/lib/quotations";
import { currentUser, isApprover } from "@/lib/auth";
import { requireModule } from "@/lib/page-guard";
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
import { RiskPill } from "../risk-pill";

const IN_PROGRESS = ["draft", "pending_approval", "approved"];

type Row = {
  id: string;
  reference: string | null;
  rep_id: string;
  status: string | null;
  net_total: number | null;
  margin_total: number | null;
  max_discount_pct: number | null;
  updated_at: string | null;
  customers: { name: string | null } | null;
};

/**
 * Every open deal across the team, ranked by value.
 *
 * This is quotation data, so it is gated on `quotationBuilder` as well as on
 * the approver role — the role says which desk you sit at, the module says
 * whether you may read quotations at all.
 */
export default async function TeamPipelinePage() {
  const { userId, role } = await currentUser();
  if (!userId) redirect("/sign-in");
  if (!isApprover(role)) redirect("/");

  await requireModule("quotationBuilder");

  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from("quotations")
    .select(
      "id, reference, rep_id, status, net_total, margin_total, max_discount_pct, updated_at, customers(name)",
    )
    .in("status", IN_PROGRESS)
    .order("net_total", { ascending: false })
    .limit(200)
    .returns<Row[]>();

  const rows = data ?? [];
  const total = rows.reduce((sum, row) => sum + Number(row.net_total ?? 0), 0);

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4">
      <PageHeader
        title="Team pipeline"
        caption={`${rows.length} open deals worth ${formatCurrency(total)}`}
        badge="All reps"
      />

      {error ? <Notice>Could not load the pipeline: {error.message}</Notice> : null}

      <Panel>
        <PanelHeader
          icon={BriefcaseIcon}
          title="Open deals"
          caption="Highest value first"
        />

        <div className="mt-3">
          <DataTable
            minWidth="46rem"
            head={
              <>
                <Th>Quotation</Th>
                <Th>Customer</Th>
                <Th className="w-36">Status</Th>
                <Th className="w-28">Risk</Th>
                <Th className="w-28 text-right">Value</Th>
                <Th className="w-28 text-right">Margin</Th>
              </>
            }
          >
            {rows.map((row, index) => {
              const net = Number(row.net_total ?? 0);
              const margin = Number(row.margin_total ?? 0);

              return (
                <Tr
                  key={row.id}
                  className="df-rise-in"
                  style={{ "--df-delay": `${Math.min(index * 30, 400)}ms` } as React.CSSProperties}
                >
                  <Td className="font-medium">
                    <Link
                      href={`/quotations/${row.id}`}
                      className="hover:text-amber-600 dark:hover:text-amber-400"
                    >
                      {row.reference ?? row.id}
                    </Link>
                  </Td>
                  <Td>{row.customers?.name ?? "—"}</Td>
                  <Td>
                    <StatusBadge status={row.status ?? "draft"} />
                  </Td>
                  <Td>
                    <RiskPill
                      score={riskScoreFromTotals({
                        maxDiscountPct: Number(row.max_discount_pct ?? 0),
                        net,
                        margin,
                      })}
                    />
                  </Td>
                  <Td className="text-right font-medium tabular-nums">
                    {formatCurrency(net)}
                  </Td>
                  <Td className="text-right tabular-nums text-muted-foreground">
                    {formatCurrency(margin)}
                  </Td>
                </Tr>
              );
            })}

            {rows.length === 0 ? (
              <EmptyRow colSpan={6}>No open deals across the team.</EmptyRow>
            ) : null}
          </DataTable>
        </div>
      </Panel>
    </main>
  );
}

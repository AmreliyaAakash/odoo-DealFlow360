import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, WarningIcon } from "@phosphor-icons/react/dist/ssr";
import {
  asCustomerTier,
  ceilingHelperText,
  discountCeiling,
  riskBand,
  type ApprovalLevel,
  type DiscountRule,
} from "@/lib/business-logic";
import { requireModule } from "@/lib/page-guard";
import { formatCurrency, formatPercent } from "@/lib/quotations";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { nameFor, resolveUserNames } from "@/lib/users-server";
import { cn } from "@/lib/utils";
import { ApprovalBanner } from "@/components/dashboard/approval-banner";
import {
  DecisionTimeline,
  type Decision,
} from "@/components/dashboard/decision-timeline";
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
import { TierBadge } from "@/components/dashboard/tier-badge";
import { ApprovalDecision } from "./approval-decision";

/**
 * Screen 6 — one quotation, seen from the approver's side.
 *
 * The point of this screen is the line table below: the blended score alone
 * tells an approver a deal is risky but not what to argue about. Showing every
 * line against its own ceiling makes the one service line that broke a stricter
 * limit obvious, which is the case the whole routing model exists for.
 */

type QuotationRow = {
  id: string;
  reference: string | null;
  status: string | null;
  rep_id: string;
  net_total: number | null;
  margin_total: number | null;
  max_discount_pct: number | null;
  risk_score: number | null;
  required_approvals: string[] | null;
  submitted_by: string | null;
  submitted_at: string | null;
  customers: { name: string | null; tier: string | null } | null;
  quotation_lines: {
    id: string;
    qty: number;
    discount_pct: number;
    unit_price: number;
    products: { name: string; category: string; cadence: string | null } | null;
  }[];
};

type DecisionRow = {
  id: string;
  level: string;
  action: string;
  reason: string | null;
  decided_by: string;
  decided_at: string;
};

export default async function ApprovalDetailPage({
  params,
}: PageProps<"/approvals/[id]">) {
  const { id } = await params;
  const actor = await requireModule("approvals");
  const supabase = createServerSupabaseClient();

  const quotationPromise = (async () => {
    const res = await supabase
      .from("quotations")
      .select(
        `id, reference, status, rep_id, net_total, margin_total, max_discount_pct,
         risk_score, required_approvals, submitted_by, submitted_at,
         customers(name, tier),
         quotation_lines(id, qty, discount_pct, unit_price,
                         products(name, category, cadence))`,
      )
      .eq("id", id)
      .maybeSingle<QuotationRow>();

    if (!res.error) return res;

    // Fallback if customers.tier is not present
    const fallback = await supabase
      .from("quotations")
      .select(
        `id, reference, status, rep_id, net_total, margin_total, max_discount_pct,
         risk_score, required_approvals, submitted_by, submitted_at,
         customers(name),
         quotation_lines(id, qty, discount_pct, unit_price,
                         products(name, category, cadence))`,
      )
      .eq("id", id)
      .maybeSingle<any>();

    if (fallback.error || !fallback.data) return res;

    return {
      data: {
        ...fallback.data,
        customers: fallback.data.customers
          ? { name: fallback.data.customers.name, tier: "standard" }
          : null,
      } as QuotationRow,
      error: null,
    };
  })();

  const rulesPromise = (async () => {
    const res = await supabase
      .from("discount_rules")
      .select("scope, scope_ref, customer_tier, max_discount_pct")
      .eq("active", true)
      .returns<DiscountRule[]>();

    if (!res.error) return res;

    const fallback = await supabase
      .from("discount_rules")
      .select("scope, scope_ref, max_discount_pct")
      .eq("active", true);

    if (fallback.error || !fallback.data) return res;

    return {
      data: (fallback.data as any[]).map((r) => ({
        ...r,
        customer_tier: null,
      })) as DiscountRule[],
      error: null,
    };
  })();

  const [quotationResult, decisionsResult, rulesResult] = await Promise.all([
    quotationPromise,
    supabase
      .from("approvals")
      .select("id, level, action, reason, decided_by, decided_at")
      .eq("quotation_id", id)
      .order("decided_at", { ascending: true })
      .returns<DecisionRow[]>(),
    rulesPromise,
  ]);

  if (quotationResult.error) {
    throw new Error(`Failed to load quotation: ${quotationResult.error.message}`);
  }
  if (!quotationResult.data) notFound();

  const quotation = quotationResult.data;
  const status = quotation.status ?? "draft";
  const tier = asCustomerTier(quotation.customers?.tier);
  const rules = rulesResult.data ?? [];

  // Only decisions from the current round count. A rep may edit a quotation
  // while it is in approval, which moves `submitted_at` — an approval given
  // before that was given on figures that no longer exist.
  const roundStartedAt = quotation.submitted_at
    ? new Date(quotation.submitted_at).getTime()
    : 0;
  const decisionRows = decisionsResult.data ?? [];
  const approvedLevels = new Set(
    decisionRows
      .filter(
        (row) =>
          row.action === "approve" &&
          new Date(row.decided_at).getTime() >= roundStartedAt,
      )
      .map((row) => row.level),
  );

  const required = quotation.required_approvals ?? [];
  const outstanding =
    status === "pending_approval"
      ? required.filter((level) => !approvedLevels.has(level))
      : [];

  const names = await resolveUserNames([
    ...decisionRows.map((row) => row.decided_by),
    ...(quotation.submitted_by ? [quotation.submitted_by] : []),
  ]);

  const decisions: Decision[] = decisionRows.map((row) => ({
    id: row.id,
    level: row.level,
    action: row.action,
    reason: row.reason,
    decidedBy: nameFor(names, row.decided_by),
    decidedAt: row.decided_at,
  }));

  // Every line against the ceiling that applies to it, which is where a
  // "blended" score stops being a number and starts being an argument.
  const lines = quotation.quotation_lines.map((line) => {
    const product = line.products;
    const facts = {
      category: product?.category ?? "Uncategorized",
      cadence: product?.cadence as never,
    };
    const ceiling = product ? discountCeiling(facts, tier, rules) : null;
    const given = Number(line.discount_pct);

    return {
      id: line.id,
      name: product?.name ?? "Unknown product",
      category: facts.category,
      given,
      ceiling,
      over: ceiling === null ? 0 : Math.max(0, given - ceiling),
      helper: product ? ceilingHelperText(facts, tier, rules) : null,
    };
  });

  const worst = lines.reduce((max, line) => Math.max(max, line.over), 0);
  const risk = quotation.risk_score ?? 0;
  const marginPct =
    quotation.net_total && quotation.net_total !== 0
      ? (quotation.margin_total ?? 0) / quotation.net_total
      : null;

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4">
      <PageHeader
        title={`Approval — ${quotation.reference ?? quotation.id.slice(0, 8)}`}
        caption={quotation.customers?.name ?? "Unassigned customer"}
      >
        <TierBadge tier={tier} />
        <StatusBadge status={status} />
        <Link
          href="/approvals"
          className="flex h-8 items-center gap-1.5 rounded-lg bg-muted px-3 text-xs font-medium transition-colors hover:bg-muted/70"
        >
          <ArrowLeftIcon size={13} />
          Queue
        </Link>
        <Link
          href={`/quotations/${quotation.id}`}
          className="flex h-8 items-center rounded-lg bg-muted px-3 text-xs font-medium transition-colors hover:bg-muted/70"
        >
          Open quotation
        </Link>
      </PageHeader>

      <ApprovalBanner
        verdict={{
          blendedRiskScore: risk,
          needsManager: required.includes("manager" satisfies ApprovalLevel),
          needsFinance: required.includes("finance" satisfies ApprovalLevel),
          needsAdmin: required.includes("admin" satisfies ApprovalLevel),
        }}
      />

      <Panel delay={60}>
        <PanelHeader
          icon={WarningIcon}
          title="Why this quote was flagged"
          caption={
            worst > 0
              ? `Worst single line is ${worst.toFixed(0)}pt over its own limit`
              : "No single line breaks its limit — the blended pattern did"
          }
        />

        <dl className="mt-3 flex flex-wrap gap-6">
          <Figure label="Blended risk" value={`${risk} · ${riskBand(risk)}`} />
          <Figure
            label="Deepest discount"
            value={`${Number(quotation.max_discount_pct ?? 0).toFixed(0)}%`}
          />
          <Figure label="Net" value={formatCurrency(quotation.net_total ?? 0)} />
          <Figure label="Margin" value={formatPercent(marginPct)} />
        </dl>

        <div className="mt-3">
          <DataTable
            minWidth="44rem"
            head={
              <>
                <Th>Line</Th>
                <Th className="w-28 text-right">Discount given</Th>
                <Th className="w-28 text-right">Limit allowed</Th>
                <Th className="w-32">Over by</Th>
              </>
            }
          >
            {lines.map((line) => (
              <Tr key={line.id}>
                <Td className="font-medium">
                  {line.name}
                  <span className="ml-1.5 text-[11px] text-muted-foreground">
                    ({line.category})
                  </span>
                </Td>
                <Td className="text-right tabular-nums">{line.given.toFixed(0)}%</Td>
                <Td className="text-right tabular-nums text-muted-foreground">
                  {line.ceiling === null ? "—" : `${line.ceiling.toFixed(0)}%`}
                </Td>
                <Td>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-medium",
                      line.over > 0
                        ? "bg-red-500/10 text-red-600 dark:text-red-400"
                        : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                    )}
                  >
                    {line.over > 0 ? `${line.over.toFixed(0)} pt OVER` : "OK"}
                  </span>
                </Td>
              </Tr>
            ))}

            {lines.length === 0 ? (
              <EmptyRow colSpan={4}>This quotation has no lines.</EmptyRow>
            ) : null}
          </DataTable>
        </div>
      </Panel>

      <DecisionTimeline decisions={decisions} outstanding={outstanding} />

      <ApprovalDecision
        quotationId={quotation.id}
        reference={quotation.reference ?? quotation.id.slice(0, 8)}
        outstanding={outstanding}
        decidable={status === "pending_approval"}
        canDecide={actor.canWrite}
        role={actor.role}
      />
    </main>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium tabular-nums capitalize">{value}</dd>
    </div>
  );
}

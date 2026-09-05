import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, ReceiptIcon } from "@phosphor-icons/react/dist/ssr";
import { asCustomerTier, type ApprovalLevel } from "@/lib/business-logic";
import {
  formatCurrency,
  formatPercent,
  type Product,
  type QuotationLineInput,
} from "@/lib/quotations";
import { resolveUserNames, nameFor } from "@/lib/users-server";
import { QuoteLineRow } from "@/components/QuoteLineRow";
import { ApprovalBanner } from "@/components/dashboard/approval-banner";
import {
  DecisionTimeline,
  type Decision,
} from "@/components/dashboard/decision-timeline";
import {
  DataTable,
  EmptyRow,
  Notice,
  PageHeader,
  Panel,
  PanelHeader,
  Th,
} from "@/components/dashboard/panel";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { TierBadge } from "@/components/dashboard/tier-badge";
import { loadBuilderData, requireBuilderAccess } from "../builder-data";
import { QuotationForm, type QuotationDraft } from "../quotation-form";
import { createServerSupabaseClient } from "@/lib/supabase-server";

/** Statuses a rep may still edit. Anything further along is read-only. */
const EDITABLE_STATUSES = new Set(["draft", "returned"]);

type DecisionRow = {
  id: string;
  level: string;
  action: string;
  reason: string | null;
  decided_by: string;
  decided_at: string;
};

type QuotationRow = {
  id: string;
  reference: string | null;
  status: string | null;
  rep_id: string;
  customer_id: string | null;
  net_total: number | null;
  margin_total: number | null;
  discount_total: number | null;
  risk_score: number | null;
  required_approvals: string[] | null;
  customers: { id: string; name: string | null; tier: string | null } | null;
  quotation_lines: {
    id: string;
    product_id: string;
    qty: number;
    discount_pct: number;
    unit_price: number;
    subscription_plan_id: string | null;
  }[];
};

/**
 * B3 — one quotation.
 *
 * The same form as /quotations/new while the quote is still a draft, and a
 * read/status view once it has been submitted. Which one you get is the
 * quotation's status crossed with your own write access, not a separate screen.
 */
export default async function QuotationPage({
  params,
}: PageProps<"/quotations/[id]">) {
  const { id } = await params;
  const actor = await requireBuilderAccess();
  const supabase = createServerSupabaseClient();

  const [quotationResult, decisionsResult, data] = await Promise.all([
    supabase
      .from("quotations")
      .select(
        `id, reference, status, rep_id, customer_id, net_total, margin_total,
         discount_total, risk_score, required_approvals,
         customers(id, name, tier),
         quotation_lines(id, product_id, qty, discount_pct, unit_price,
                         subscription_plan_id)`,
      )
      .eq("id", id)
      .maybeSingle<QuotationRow>(),
    supabase
      .from("approvals")
      .select("id, level, action, reason, decided_by, decided_at")
      .eq("quotation_id", id)
      .order("decided_at", { ascending: true })
      .returns<DecisionRow[]>(),
    loadBuilderData(),
  ]);

  if (quotationResult.error) {
    throw new Error(`Failed to load quotation: ${quotationResult.error.message}`);
  }
  if (!quotationResult.data) notFound();

  const quotation = quotationResult.data;
  const status = quotation.status ?? "draft";

  // Own-scope means own quotations: RLS would already have returned nothing, but
  // a rep who reaches another rep's quote by URL deserves a 404, not a blank page.
  if (actor.scope === "own" && quotation.rep_id !== actor.userId) notFound();

  const editable = actor.canWrite && EDITABLE_STATUSES.has(status);

  const levels = new Set(quotation.required_approvals ?? []);
  const verdict = {
    blendedRiskScore: quotation.risk_score ?? 0,
    needsManager: levels.has("manager" satisfies ApprovalLevel),
    needsFinance: levels.has("finance" satisfies ApprovalLevel),
    needsAdmin: levels.has("admin" satisfies ApprovalLevel),
  };

  // Who still owes a decision: a level this deal required that has not yet
  // approved. Rejections and returns end the round, so they leave nothing open.
  const decisionRows = decisionsResult.data ?? [];
  const approvedLevels = new Set(
    decisionRows.filter((row) => row.action === "approve").map((row) => row.level),
  );
  const outstanding =
    status === "pending_approval"
      ? (quotation.required_approvals ?? []).filter(
          (level) => !approvedLevels.has(level),
        )
      : [];

  const deciderNames = await resolveUserNames(
    decisionRows.map((row) => row.decided_by),
  );
  const decisions: Decision[] = decisionRows.map((row) => ({
    id: row.id,
    level: row.level,
    action: row.action,
    reason: row.reason,
    decidedBy: nameFor(deciderNames, row.decided_by),
    decidedAt: row.decided_at,
  }));

  const draft: QuotationDraft = {
    id: quotation.id,
    customerId: quotation.customer_id,
    reference: quotation.reference,
    lines: quotation.quotation_lines.map((line) => ({
      productId: line.product_id,
      qty: Number(line.qty),
      discountPct: Number(line.discount_pct),
      unitPrice: Number(line.unit_price),
      subscriptionPlanId: line.subscription_plan_id,
    })),
  };

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4">
      <PageHeader
        title={quotation.reference ?? `Quotation ${quotation.id.slice(0, 8)}`}
        caption={quotation.customers?.name ?? "Unassigned customer"}
      >
        {quotation.customers ? (
          <TierBadge tier={asCustomerTier(quotation.customers.tier)} />
        ) : null}
        <StatusBadge status={status} />
        <Link
          href="/quotations"
          className="flex h-8 items-center gap-1.5 rounded-lg bg-muted px-3 text-xs font-medium transition-colors hover:bg-muted/70"
        >
          <ArrowLeftIcon size={13} />
          Pipeline
        </Link>
      </PageHeader>

      {/* Read straight off the saved row, so the verdict shown is the verdict
          the approvals queue is working from. */}
      <ApprovalBanner verdict={verdict} />

      <DecisionTimeline decisions={decisions} outstanding={outstanding} />

      {editable ? (
        <QuotationForm
          customers={data.customers}
          catalog={data.catalog}
          plans={data.plans}
          discountRules={data.discountRules}
          draft={draft}
        />
      ) : (
        <ReadOnlyLines
          quotation={quotation}
          catalog={data.catalog}
          reason={
            actor.canWrite
              ? `This quotation is ${status.replace(/_/g, " ")} and can no longer be edited.`
              : "You have review access to this quotation, not edit access."
          }
        />
      )}
    </main>
  );
}

function ReadOnlyLines({
  quotation,
  catalog,
  reason,
}: {
  quotation: QuotationRow;
  catalog: Product[];
  reason: string;
}) {
  const productsById = new Map(catalog.map((product) => [product.id, product]));
  const marginPct =
    quotation.net_total && quotation.net_total !== 0
      ? (quotation.margin_total ?? 0) / quotation.net_total
      : null;

  return (
    <>
      <Notice>{reason}</Notice>

      <Panel>
        <PanelHeader
          icon={ReceiptIcon}
          title="Line items"
          caption={`${quotation.quotation_lines.length} line${
            quotation.quotation_lines.length === 1 ? "" : "s"
          } · ${formatCurrency(quotation.net_total ?? 0)} · ${formatPercent(marginPct)} margin`}
        />

        <div className="mt-3">
          <DataTable
            minWidth="48rem"
            head={
              <>
                <Th>Product</Th>
                <Th className="w-28 text-right">Unit</Th>
                <Th className="w-20">Qty</Th>
                <Th className="w-24">Disc %</Th>
                <Th className="w-20 text-right">Depth</Th>
                <Th className="w-28 text-right">Net</Th>
                <Th className="w-28 text-right">Margin</Th>
                <Th className="w-10" />
              </>
            }
          >
            {quotation.quotation_lines.map((row, index) => {
              const product = productsById.get(row.product_id);
              if (!product) return null;

              const line: QuotationLineInput = {
                productId: row.product_id,
                qty: Number(row.qty),
                discountPct: Number(row.discount_pct),
                // The snapshot, not today's list price — a signed quote must not
                // move when the catalog does.
                unitPrice: Number(row.unit_price),
              };

              return (
                // No handlers: this is a Server Component, and a function prop
                // cannot cross into a Client Component even as a no-op.
                <QuoteLineRow
                  key={row.id}
                  product={product}
                  line={line}
                  index={index}
                  readOnly
                />
              );
            })}

            {quotation.quotation_lines.length === 0 ? (
              <EmptyRow colSpan={8}>This quotation has no lines.</EmptyRow>
            ) : null}
          </DataTable>
        </div>
      </Panel>
    </>
  );
}

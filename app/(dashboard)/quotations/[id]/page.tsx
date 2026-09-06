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
import { loadLedger } from "@/lib/invoices-server";
import { QuoteLineRow } from "@/components/QuoteLineRow";
import { WarehouseSplitView } from "@/components/WarehouseSplitView";
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
import { CustomerMessagePanel } from "@/components/negotiation/message-panel";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { TierBadge } from "@/components/dashboard/tier-badge";
import { loadBuilderData, requireBuilderAccess } from "../builder-data";
import { QuotationForm, type QuotationDraft } from "../quotation-form";
import { OrderPanel } from "./order-panel";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import {
  ALLOCATABLE_STATUSES,
  loadSplitForQuotation,
} from "@/lib/warehouse-split-server";

/** Once confirmed, the deal has a money side and the order panel appears. */
const ORDERABLE_STATUSES = new Set(["won"]);

/**
 * Statuses a rep may still edit: everything up to the desk actually saying yes.
 * A quote waiting on an approver is still the rep's to correct — editing it
 * re-opens the round server-side, so no earlier sign-off carries over.
 */
const EDITABLE_STATUSES = new Set(["draft", "returned", "pending_approval"]);

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
  notes: string | null;
  status: string | null;
  rep_id: string;
  customer_id: string | null;
  submitted_at: string | null;
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
 * The same row from a database that predates `customers.tier` and
 * `quotation_lines.subscription_plan_id` — the two columns the fallback query
 * below leaves out. Spelled as its own type rather than `any` so the mapping
 * back to QuotationRow is checked: those two fields are the only ones it is
 * allowed to invent.
 */
type LegacyQuotationRow = Omit<QuotationRow, "customers" | "quotation_lines"> & {
  customers: { id: string; name: string | null } | null;
  quotation_lines: Omit<
    QuotationRow["quotation_lines"][number],
    "subscription_plan_id"
  >[];
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

  const quotationPromise = (async () => {
    const res = await supabase
      .from("quotations")
      .select(
        `id, reference, notes, status, rep_id, customer_id, submitted_at,
         net_total, margin_total, discount_total, risk_score, required_approvals,
         customers(id, name, tier),
         quotation_lines(id, product_id, qty, discount_pct, unit_price,
                         subscription_plan_id)`,
      )
      .eq("id", id)
      .maybeSingle<QuotationRow>();

    if (!res.error) return res;

    // Fallback if 'tier' or 'subscription_plan_id' columns don't exist yet
    const fallback = await supabase
      .from("quotations")
      .select(
        `id, reference, notes, status, rep_id, customer_id, submitted_at,
         net_total, margin_total, discount_total, risk_score, required_approvals,
         customers(id, name),
         quotation_lines(id, product_id, qty, discount_pct, unit_price)`,
      )
      .eq("id", id)
      .maybeSingle<LegacyQuotationRow>();

    if (fallback.error || !fallback.data) return res;

    const row = fallback.data;
    const formatted: QuotationRow = {
      ...row,
      notes: row.notes ?? null,
      customers: row.customers
        ? { id: row.customers.id, name: row.customers.name, tier: "standard" }
        : null,
      quotation_lines: (row.quotation_lines ?? []).map((line) => ({
        ...line,
        subscription_plan_id: null,
      })),
    };

    return { data: formatted, error: null };
  })();

  const [quotationResult, decisionsResult, data, messageResult] = await Promise.all([
    quotationPromise,
    supabase
      .from("approvals")
      .select("id, level, action, reason, decided_by, decided_at")
      .eq("quotation_id", id)
      .order("decided_at", { ascending: true })
      .returns<DecisionRow[]>(),
    loadBuilderData(),
    // Head-only count, so the collapsed panel can say how many messages are
    // waiting without the page loading the conversation nobody has opened yet.
    supabase
      .from("negotiation_messages")
      .select("id", { count: "exact", head: true })
      .eq("quotation_id", id),
  ]);

  // A count is decoration on this page; a failure must not take the quote down.
  const messageCount = messageResult.count ?? 0;

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
  // Only decisions from the current round count. An edit while the quote was in
  // approval moves `submitted_at`, which is what makes an earlier approval stop
  // counting — it was given on terms that no longer exist.
  const roundStartedAt = quotation.submitted_at
    ? new Date(quotation.submitted_at).getTime()
    : 0;
  const approvedLevels = new Set(
    decisionRows
      .filter(
        (row) =>
          row.action === "approve" &&
          new Date(row.decided_at).getTime() >= roundStartedAt,
      )
      .map((row) => row.level),
  );
  const outstanding =
    status === "pending_approval"
      ? (quotation.required_approvals ?? []).filter(
          (level) => !approvedLevels.has(level),
        )
      : [];

  // Only loaded when there is something to allocate against, so a draft does no
  // stock work at all.
  const splitResult =
    ALLOCATABLE_STATUSES.has(status) && actor.canViewSplit
      ? await loadSplitForQuotation(quotation.id)
      : null;
  const split = splitResult && !("error" in splitResult) ? splitResult : null;

  // Billing only exists after the customer has confirmed, so a quote that is
  // merely approved does no ledger work at all.
  const billing =
    ORDERABLE_STATUSES.has(status) && actor.canViewBilling
      ? await loadOrderForQuotation(quotation.id)
      : null;

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
    notes: quotation.notes,
    status,
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

      {/* Fulfilment only becomes a question once the deal is real — before that
          there is nothing to reserve stock against. */}
      {split ? (
        <WarehouseSplitView
          quotationId={quotation.id}
          canCommit={actor.canCommitSplit}
          initial={split}
        />
      ) : null}

      {splitResult && "error" in splitResult ? (
        <Notice tone="danger">
          Could not load the fulfilment split: {splitResult.error}
        </Notice>
      ) : null}

      {billing ? (
        <OrderPanel
          quotationId={quotation.id}
          order={billing.order}
          invoices={billing.invoices}
          canRaise={actor.canWriteBilling}
        />
      ) : null}

      {editable ? (
        <QuotationForm
          customers={data.customers}
          catalog={data.catalog}
          plans={data.plans}
          discountRules={data.discountRules}
          priceLists={data.priceLists}
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

      {/*
        The customer conversation, on the desk side.

        Every staff role that can open this page can read it — the API and the
        RLS policy behind it both key on `quotationBuilder`, so a rep at `own`
        scope only ever resolves their own threads while a manager, finance user
        or admin resolves all of them. Posting is narrower: the portal module,
        and only on a quotation this rep owns. Everyone else reads.
      */}
      <CustomerMessagePanel
        quotationId={quotation.id}
        canPost={actor.canMessage && quotation.rep_id === actor.userId}
        initialCount={messageCount}
      />
    </main>
  );
}

/**
 * The order raised from this quotation, with its invoices — or nulls when it has
 * not been ordered yet, which is what the panel renders its button for.
 */
async function loadOrderForQuotation(quotationId: string) {
  const supabase = createServerSupabaseClient();

  const { data: order } = await supabase
    .from("orders")
    .select("id, reference, status")
    .eq("quotation_id", quotationId)
    .maybeSingle<{ id: string; reference: string | null; status: string }>();

  if (!order) return { order: null, invoices: [] };

  const ledger = await loadLedger(order.id);
  return { order, invoices: ledger.invoices };
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

      {quotation.notes ? (
        <Panel>
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            Description / Notes
          </p>
          <p className="mt-1 text-xs text-foreground whitespace-pre-wrap">
            {quotation.notes}
          </p>
        </Panel>
      ) : null}

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

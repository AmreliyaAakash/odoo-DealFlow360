"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  PaperPlaneTiltIcon,
  PlusIcon,
  ReceiptIcon,
  SpinnerIcon,
  TrashIcon,
  UserIcon,
} from "@phosphor-icons/react";
import {
  asCustomerTier,
  CUSTOMER_TIERS,
  ceilingHelperText,
  discountCeiling,
  priceForTier,
  priceRuleSummary,
  TIER_LABELS,
  type CustomerTier,
  type DiscountRule,
  type PriceListEntry,
} from "@/lib/business-logic";
import {
  PRODUCT_KIND_LABELS,
  formatCurrency,
  formatPercent,
  lineTotals,
  productKind,
  summarize,
  type Product,
  type QuotationLineInput,
} from "@/lib/quotations";
import { cn } from "@/lib/utils";
import {
  ApprovalBanner,
  type ApprovalVerdictView,
} from "@/components/dashboard/approval-banner";
import { Notice, Panel, PanelHeader } from "@/components/dashboard/panel";
import {
  SearchableSelect,
  type SelectOption,
} from "@/components/dashboard/searchable-select";
import { TierBadge } from "@/components/dashboard/tier-badge";
import { UpsellPanel } from "@/components/UpsellPanel";

export type CustomerOption = { id: string; name: string | null; tier: string | null };

export type SubscriptionPlan = {
  id: string;
  name: string;
  cadence: string;
  unit_price: number;
};

/** An existing quotation, when the form is opened to edit rather than create. */
export type QuotationDraft = {
  id: string;
  customerId: string | null;
  reference: string | null;
  /** Current status, so the form can say what saving will actually do. */
  status?: string | null;
  notes?: string | null;
  lines: {
    productId: string;
    qty: number;
    discountPct: number;
    unitPrice: number;
    subscriptionPlanId: string | null;
  }[];
};

/**
 * One editable row. `key` is local and never sent: two lines may hold the same
 * product on different terms, so the product id cannot double as the React key.
 */
type FormLine = {
  key: string;
  productId: string | null;
  qty: number;
  unitPrice: number;
  discountPct: number;
  subscriptionPlanId: string | null;
  /** Fields the rep has actually visited, so a pristine row is not scolded. */
  touched: Partial<Record<LineField, boolean>>;
};

type LineField = "product" | "qty" | "unitPrice" | "discount";
type LineErrors = Partial<Record<LineField, string>>;

let nextKey = 0;
const freshLine = (): FormLine => ({
  key: `line-${nextKey++}`,
  productId: null,
  qty: 1,
  unitPrice: 0,
  discountPct: 0,
  subscriptionPlanId: null,
  touched: {},
});

/** The opening row: blank, or already holding the product the rep arrived with. */
function seedLine(catalog: Product[], productId?: string): FormLine {
  const line = freshLine();
  const product = productId
    ? catalog.find((candidate) => candidate.id === productId)
    : undefined;

  return product
    ? { ...line, productId: product.id, unitPrice: product.list_price }
    : line;
}

/**
 * B3 — the quotation builder, used to raise a quote at /quotations/new and to
 * edit an unsubmitted one at /quotations/[id].
 *
 * The rep is never a field here. It is read from the Clerk session on the server
 * when the quotation is written, so the client has nothing to send and nothing
 * to forge.
 */
export function QuotationForm({
  customers,
  catalog,
  plans,
  discountRules,
  priceLists,
  draft,
  initialProductId,
}: {
  customers: CustomerOption[];
  catalog: Product[];
  plans: SubscriptionPlan[];
  discountRules: DiscountRule[];
  priceLists: PriceListEntry[];
  draft?: QuotationDraft;
  /** Seeds the first line, for arriving from a suggestion. New quotes only. */
  initialProductId?: string;
}) {
  const router = useRouter();
  const editing = draft !== undefined;
  /** Being edited while an approver is holding it. */
  const inApproval = draft?.status === "pending_approval";

  const [customerId, setCustomerId] = useState<string | null>(
    draft?.customerId ?? null,
  );
  const [customerTouched, setCustomerTouched] = useState(false);
  const [reference, setReference] = useState(draft?.reference ?? "");
  const [notes, setNotes] = useState(draft?.notes ?? "");
  const [lines, setLines] = useState<FormLine[]>(() =>
    draft && draft.lines.length > 0
      ? draft.lines.map((line) => ({
          key: `line-${nextKey++}`,
          productId: line.productId,
          qty: line.qty,
          unitPrice: line.unitPrice,
          discountPct: line.discountPct,
          subscriptionPlanId: line.subscriptionPlanId,
          touched: {},
        }))
      : [seedLine(catalog, initialProductId)],
  );

  const [saving, setSaving] = useState<"draft" | "submit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<ApprovalVerdictView | null>(null);

  const productsById = useMemo(
    () => new Map(catalog.map((product) => [product.id, product])),
    [catalog],
  );

  const tier: CustomerTier = useMemo(
    () => asCustomerTier(customers.find((c) => c.id === customerId)?.tier),
    [customers, customerId],
  );

  /**
   * Which tier's price list the cart is priced against.
   *
   * Defaults to the customer's own tier, which is what should happen almost
   * always. It is a control rather than a fixed rule because a rep quoting a
   * standard account being onboarded onto Gold terms needs to show the Gold
   * price today, and the alternative — typing the numbers in by hand — loses
   * the record of which list they came from.
   */
  const [priceTier, setPriceTier] = useState<CustomerTier | null>(null);
  const activeTier = priceTier ?? tier;

  const priceTierOptions = useMemo<SelectOption[]>(
    () =>
      CUSTOMER_TIERS.map((option) => ({
        value: option,
        label:
          option === tier
            ? `${TIER_LABELS[option]} (customer's tier)`
            : TIER_LABELS[option],
      })),
    [tier],
  );

  /** Re-prices every line that still sits at its list-derived price. */
  function applyPriceList(next: CustomerTier) {
    setPriceTier(next);
    setVerdict(null);

    setLines((current) =>
      current.map((line) => {
        const product = line.productId
          ? productsById.get(line.productId)
          : undefined;
        if (!product) return line;

        // A price the rep typed themselves is theirs to keep — switching lists
        // must not silently undo a negotiated number. Only prices that still
        // match what the previous list produced get moved.
        const previous = priceForTier(product, activeTier, priceLists);
        if (Math.abs(line.unitPrice - previous) > 0.005) return line;

        return { ...line, unitPrice: priceForTier(product, next, priceLists) };
      }),
    );
  }

  const customerOptions = useMemo<SelectOption[]>(
    () =>
      customers.map((customer) => ({
        value: customer.id,
        label: customer.name ?? "Unnamed customer",
        badge: <TierBadge tier={asCustomerTier(customer.tier)} />,
        keywords: asCustomerTier(customer.tier),
      })),
    [customers],
  );

  const productOptions = useMemo<SelectOption[]>(
    () =>
      catalog.map((product) => ({
        value: product.id,
        label: product.name,
        group: PRODUCT_KIND_LABELS[productKind(product)],
        hint: `${formatCurrency(product.list_price)}${product.sku ? ` · ${product.sku}` : ""}`,
        keywords: `${product.sku ?? ""} ${product.category}`,
      })),
    [catalog],
  );

  const planOptions = useMemo<SelectOption[]>(
    () =>
      plans.map((plan) => ({
        value: plan.id,
        label: CADENCE_LABELS[plan.cadence] ?? plan.cadence,
        hint: `${plan.name} · ${formatCurrency(plan.unit_price)}`,
        keywords: `${plan.name} ${plan.cadence}`,
      })),
    [plans],
  );

  /** The lines that can actually be priced: a row with no product yet cannot. */
  const priceable = useMemo<QuotationLineInput[]>(
    () =>
      lines
        .filter((line) => line.productId !== null)
        .map((line) => ({
          productId: line.productId as string,
          qty: line.qty,
          discountPct: line.discountPct,
          unitPrice: line.unitPrice,
        })),
    [lines],
  );

  /** Live totals. Client-side only — the server re-prices whatever is saved. */
  const summary = useMemo(
    () => summarize(priceable, productsById),
    [priceable, productsById],
  );

  const lineErrors = useMemo(() => lines.map(validateLine), [lines]);

  const customerError = customerId === null ? "Select a customer" : null;
  const valid = customerError === null && lineErrors.every(isClean);

  const update = useCallback((key: string, patch: Partial<FormLine>) => {
    setVerdict(null);
    setLines((current) =>
      current.map((line) =>
        line.key === key
          ? { ...line, ...patch, touched: { ...line.touched, ...patch.touched } }
          : line,
      ),
    );
  }, []);

  function chooseProduct(key: string, productId: string) {
    const product = productsById.get(productId);
    if (!product) return;

    // Selecting a product refills the price from the active price list — not
    // list price — and clears a billing cycle left over from a previous,
    // subscription product.
    update(key, {
      productId,
      unitPrice: priceForTier(product, activeTier, priceLists),
      subscriptionPlanId: null,
      touched: { product: true },
    });
  }

  function addLine() {
    setVerdict(null);
    setLines((current) => [...current, freshLine()]);
  }

  /**
   * Drops a suggested product into the cart at list price.
   *
   * It fills the first empty line before appending, so accepting a suggestion on
   * a fresh quote does not leave a blank row above it. The totals update on the
   * same render because they are derived from the lines rather than refetched —
   * which is what makes the margin the panel promised and the running total on
   * screen agree.
   */
  function addSuggestion(productId: string) {
    const product = productsById.get(productId);
    if (!product) return;

    setVerdict(null);
    setLines((current) => {
      const added: FormLine = {
        ...freshLine(),
        productId,
        unitPrice: product.list_price,
        touched: { product: true },
      };

      const blank = current.findIndex((row) => row.productId === null);
      if (blank === -1) return [...current, added];

      return current.map((row, index) =>
        index === blank ? { ...added, key: row.key } : row,
      );
    });
  }

  function removeLine(key: string) {
    setVerdict(null);
    setLines((current) =>
      current.length <= 1 ? current : current.filter((line) => line.key !== key),
    );
  }

  /**
   * Saves the quotation, and optionally sends it for approval in the same call.
   *
   * Submitting is what puts a deal in front of a manager or finance: until it
   * happens the quote is a draft nobody else can see or act on.
   */
  async function save(action: "draft" | "submit") {
    if (!valid) return;

    setSaving(action);
    setError(null);
    setVerdict(null);

    const body = {
      customerId,
      reference: reference.trim() || null,
      notes: notes.trim() || null,
      submit: action === "submit",
      lines: lines.map((line) => {
        const product = productsById.get(line.productId as string) as Product;
        return {
          productId: line.productId,
          // Sent so the payload documents itself; the server re-derives it from
          // the product rather than trusting this.
          category: productKind(product),
          qty: line.qty,
          unitPrice: line.unitPrice,
          discountPct: line.discountPct,
          ...(line.subscriptionPlanId
            ? { subscriptionPlanId: line.subscriptionPlanId }
            : {}),
        };
      }),
    };

    try {
      const response = await fetch(
        editing ? `/api/quotations/${draft.id}` : "/api/quotations",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result?.error ?? "Could not save this quotation");
      }

      if (editing) {
        setVerdict(toVerdict(result));
        setSaving(null);
        router.refresh();
        return;
      }

      // The saved quote is the source of truth for the verdict, so the banner is
      // rendered by the page we land on rather than carried across the redirect.
      router.refresh();
      router.push(`/quotations/${result.id}`);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save this quotation",
      );
      setSaving(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {verdict ? <ApprovalBanner verdict={verdict} /> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}

      {inApproval ? (
        <Notice>
          This quotation is with the approvals desk. You can still change it —
          saving re-runs the routing on the new figures and restarts the round,
          so any sign-off already given no longer counts.
        </Notice>
      ) : null}

      <Panel>
        <PanelHeader
          icon={UserIcon}
          title="Header"
          caption="Who this quotation is for"
        />

        <div className="mt-3 flex flex-wrap items-start gap-3">
          <Field
            label="Customer"
            error={customerTouched ? customerError : null}
            className="w-64"
          >
            <SearchableSelect
              label="Customer"
              value={customerId}
              options={customerOptions}
              placeholder="Search customers…"
              invalid={customerTouched && customerError !== null}
              onChange={(value) => {
                setCustomerTouched(true);
                setVerdict(null);
                setCustomerId(value);
              }}
            />
          </Field>

          <Field label="Reference" className="w-52">
            <input
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder="Optional"
              className="h-8 w-full rounded-lg bg-muted/60 px-2 text-xs outline-none ring-1 ring-transparent transition focus-visible:bg-background focus-visible:ring-indigo-500"
            />
          </Field>

          <Field
            label="Price list"
            className="w-52"
            helper={priceListHelper(activeTier, priceLists)}
            helperTone={priceTier !== null && priceTier !== tier ? "warn" : undefined}
          >
            <SearchableSelect
              label="Price list"
              value={activeTier}
              options={priceTierOptions}
              onChange={(value) => applyPriceList(value as CustomerTier)}
            />
          </Field>

          <Field label="Tier" className="w-28">
            <div className="flex h-8 items-center">
              {customerId ? (
                <TierBadge tier={tier} />
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              )}
            </div>
          </Field>

          <Field label="Description / Notes" className="flex-1 min-w-[260px]">
            <input
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Quotation description, terms, or notes…"
              className="h-8 w-full rounded-lg bg-muted/60 px-2 text-xs outline-none ring-1 ring-transparent transition focus-visible:bg-background focus-visible:ring-indigo-500"
            />
          </Field>
        </div>
      </Panel>

      {/* Cart and suggestions side by side on a wide screen, stacked below it.
          The panel belongs next to the lines, not on a page of its own: its
          whole value is being visible while the rep is still choosing. */}
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <Panel delay={80} className="min-w-0">
        <PanelHeader
          icon={ReceiptIcon}
          title="Line items"
          caption={`${lines.length} line${lines.length === 1 ? "" : "s"}`}
        />

        <div className="mt-3 flex flex-col gap-3">
          {lines.map((line, index) => (
            <LineRow
              key={line.key}
              line={line}
              index={index}
              errors={lineErrors[index]}
              product={
                line.productId ? (productsById.get(line.productId) ?? null) : null
              }
              productOptions={productOptions}
              planOptions={planOptions}
              tier={tier}
              discountRules={discountRules}
              canRemove={lines.length > 1}
              onChange={(patch) => update(line.key, patch)}
              onChooseProduct={(productId) => chooseProduct(line.key, productId)}
              onRemove={() => removeLine(line.key)}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={addLine}
          className="mt-3 flex h-8 items-center gap-1.5 rounded-lg bg-muted px-3 text-xs font-medium transition-colors hover:bg-muted/70"
        >
          <PlusIcon size={13} weight="bold" />
          Add line
        </button>
      </Panel>

        <UpsellPanel lines={priceable} onAddToQuote={addSuggestion} />
      </div>

      <Panel delay={160}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <dl className="flex flex-wrap gap-6">
            <Metric label="Gross" value={formatCurrency(summary.gross)} />
            <Metric
              label="Discount"
              value={`-${formatCurrency(summary.discount)}`}
              muted
            />
            <Metric label="Running total" value={formatCurrency(summary.net)} strong />
            <Metric
              label="Margin estimate"
              value={`${formatCurrency(summary.margin)} · ${formatPercent(summary.marginPct)}`}
              tone={
                summary.marginPct !== null && summary.marginPct < 0.15
                  ? "warning"
                  : undefined
              }
            />
          </dl>

          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void save("draft")}
                disabled={!valid || saving !== null}
                className="flex h-9 items-center gap-1.5 rounded-lg bg-muted px-3 text-xs font-medium transition-colors hover:bg-muted/70 disabled:opacity-50"
              >
                {saving === "draft" ? (
                  <SpinnerIcon size={13} className="animate-spin" />
                ) : null}
                {saving === "draft"
                  ? "Saving"
                  : inApproval
                    ? "Save changes"
                    : "Save draft"}
              </button>

              <button
                type="button"
                onClick={() => void save("submit")}
                disabled={!valid || saving !== null}
                className="flex h-9 items-center gap-1.5 rounded-lg bg-zinc-900 px-4 text-xs font-medium text-zinc-50 transition-colors hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                {saving === "submit" ? (
                  <SpinnerIcon size={13} className="animate-spin" />
                ) : (
                  <PaperPlaneTiltIcon size={13} />
                )}
                {saving === "submit"
                  ? "Submitting"
                  : inApproval
                    ? "Resubmit for approval"
                    : "Submit for approval"}
              </button>
            </div>

            {/* Never a silent disabled button: say what is still missing. */}
            {!valid ? (
              <p className="text-[11px] text-muted-foreground">
                {blockingReason(customerError, lineErrors)}
              </p>
            ) : null}
          </div>
        </div>
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * One line
 * ------------------------------------------------------------------ */

function LineRow({
  line,
  index,
  errors,
  product,
  productOptions,
  planOptions,
  tier,
  discountRules,
  canRemove,
  onChange,
  onChooseProduct,
  onRemove,
}: {
  line: FormLine;
  index: number;
  errors: LineErrors;
  product: Product | null;
  productOptions: SelectOption[];
  planOptions: SelectOption[];
  tier: CustomerTier;
  discountRules: DiscountRule[];
  canRemove: boolean;
  onChange: (patch: Partial<FormLine>) => void;
  onChooseProduct: (productId: string) => void;
  onRemove: () => void;
}) {
  const totals = product
    ? lineTotals(product, {
        productId: product.id,
        qty: line.qty,
        discountPct: line.discountPct,
        unitPrice: line.unitPrice,
      })
    : null;

  const subscription = product !== null && productKind(product) === "subscription";
  const ceiling = product ? discountCeiling(product, tier, discountRules) : null;

  // Over the ceiling is not invalid — it is allowed, it just escalates. Warn in
  // the helper text rather than blocking a discount the desk can still approve.
  const overCeiling = ceiling !== null && line.discountPct > ceiling;

  const show = (field: LineField) =>
    line.touched[field] ? (errors[field] ?? null) : null;

  return (
    <div
      className="df-rise-in flex flex-wrap items-start gap-3 rounded-xl bg-muted/30 p-3 ring-1 ring-foreground/5"
      style={{ "--df-delay": `${index * 40}ms` } as React.CSSProperties}
    >
      <Field label="Product" error={show("product")} className="w-64">
        <SearchableSelect
          label={`Product for line ${index + 1}`}
          value={line.productId}
          options={productOptions}
          placeholder="Search catalog…"
          invalid={show("product") !== null}
          onChange={onChooseProduct}
        />
      </Field>

      <Field label="Qty" error={show("qty")} className="w-20">
        <NumberInput
          value={line.qty}
          min={1}
          step={1}
          label={`Quantity for line ${index + 1}`}
          invalid={show("qty") !== null}
          onChange={(qty) => onChange({ qty, touched: { qty: true } })}
        />
      </Field>

      <Field label="Unit price" error={show("unitPrice")} className="w-28">
        <NumberInput
          value={line.unitPrice}
          min={0}
          step={100}
          label={`Unit price for line ${index + 1}`}
          invalid={show("unitPrice") !== null}
          onChange={(unitPrice) =>
            onChange({ unitPrice, touched: { unitPrice: true } })
          }
        />
      </Field>

      <Field
        label="Discount %"
        error={show("discount")}
        className="w-44"
        helper={product ? ceilingHelperText(product, tier, discountRules) : undefined}
        helperTone={overCeiling ? "warn" : undefined}
      >
        <NumberInput
          value={line.discountPct}
          min={0}
          max={100}
          step={1}
          label={`Discount for line ${index + 1}`}
          invalid={show("discount") !== null}
          onChange={(discountPct) =>
            onChange({ discountPct, touched: { discount: true } })
          }
        />
      </Field>

      {/* Screen 4's Limit and Status columns. The helper text under Discount
          already names the rule; these two say the same thing as a number and a
          verdict, which is what an approver skims for. */}
      <Field label="Limit" className="w-20">
        <div className="flex h-8 items-center">
          <span className="text-xs tabular-nums">
            {ceiling === null ? "—" : `${ceiling.toFixed(0)}%`}
          </span>
        </div>
      </Field>

      <Field label="Status" className="w-28">
        <div className="flex h-8 items-center">
          {ceiling === null ? (
            <span className="text-[11px] text-muted-foreground">No ceiling</span>
          ) : overCeiling ? (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium tabular-nums text-amber-700 dark:text-amber-400">
              OVER +{(line.discountPct - ceiling).toFixed(0)}pt
            </span>
          ) : (
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
              OK
            </span>
          )}
        </div>
      </Field>

      {subscription ? (
        <Field label="Billing cycle" className="w-40">
          <SearchableSelect
            label={`Billing cycle for line ${index + 1}`}
            value={line.subscriptionPlanId}
            options={planOptions}
            placeholder="Choose cycle…"
            emptyText="No plans configured"
            onChange={(subscriptionPlanId) => onChange({ subscriptionPlanId })}
          />
        </Field>
      ) : null}

      <Field label="Line total" className="w-28">
        <div className="flex h-8 flex-col justify-center">
          <span className="text-xs font-medium tabular-nums">
            {totals ? formatCurrency(totals.net) : "—"}
          </span>
          {totals ? (
            <span
              className={cn(
                "text-[10px] tabular-nums",
                totals.net > 0 && totals.margin / totals.net < 0.15
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-muted-foreground",
              )}
            >
              {formatCurrency(totals.margin)} margin
            </span>
          ) : null}
        </div>
      </Field>

      <div className="flex h-8 items-center self-end pb-0.5">
        <button
          type="button"
          onClick={onRemove}
          disabled={!canRemove}
          aria-label={`Remove line ${index + 1}`}
          title={canRemove ? "Remove line" : "A quotation needs at least one line"}
          className="text-muted-foreground transition-colors hover:text-destructive disabled:opacity-30 disabled:hover:text-muted-foreground"
        >
          <TrashIcon size={14} />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

function validateLine(line: FormLine): LineErrors {
  const errors: LineErrors = {};

  if (!line.productId) errors.product = "Choose a product";
  if (!Number.isFinite(line.qty) || line.qty < 1) errors.qty = "Must be at least 1";
  if (!Number.isFinite(line.unitPrice) || line.unitPrice < 0) {
    errors.unitPrice = "Cannot be negative";
  }
  if (!Number.isFinite(line.discountPct)) {
    errors.discount = "Enter a number";
  } else if (line.discountPct < 0) {
    errors.discount = "Cannot be below 0%";
  } else if (line.discountPct > 100) {
    errors.discount = "Cannot exceed 100%";
  }

  return errors;
}

function isClean(errors: LineErrors): boolean {
  return Object.keys(errors).length === 0;
}

/** What is still standing between the rep and a saveable quotation. */
function blockingReason(
  customerError: string | null,
  lineErrors: LineErrors[],
): string {
  if (customerError) return "Select a customer to continue";

  const index = lineErrors.findIndex((errors) => !isClean(errors));
  if (index === -1) return "";

  const first = Object.values(lineErrors[index])[0];
  return `Line ${index + 1}: ${first.toLowerCase()}`;
}

/* ------------------------------------------------------------------ *
 * Small pieces
 * ------------------------------------------------------------------ */

const CADENCE_LABELS: Record<string, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  // The schema says `annual`; the sales floor says yearly. Show theirs.
  annual: "Yearly",
};

function Field({
  label,
  error,
  helper,
  helperTone,
  className,
  children,
}: {
  label: string;
  error?: string | null;
  helper?: string;
  helperTone?: "warn";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <span className="text-[11px] text-muted-foreground">{label}</span>
      {children}
      {error ? (
        <span className="text-[11px] text-red-600 dark:text-red-400">{error}</span>
      ) : helper ? (
        <span
          className={cn(
            "text-[11px]",
            helperTone === "warn"
              ? "font-medium text-amber-600 dark:text-amber-400"
              : "text-muted-foreground",
          )}
        >
          {helper}
        </span>
      ) : null}
    </div>
  );
}

function NumberInput({
  value,
  min,
  max,
  step,
  label,
  invalid,
  onChange,
}: {
  value: number;
  min: number;
  max?: number;
  step: number;
  label: string;
  invalid?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <input
      type="number"
      inputMode="decimal"
      value={Number.isFinite(value) ? value : ""}
      min={min}
      max={max}
      step={step}
      aria-label={label}
      aria-invalid={invalid || undefined}
      onChange={(event) => onChange(event.target.valueAsNumber)}
      className={cn(
        "h-8 w-full rounded-lg bg-muted/60 px-2 text-right text-xs tabular-nums outline-none ring-1 transition focus-visible:bg-background focus-visible:ring-indigo-500",
        invalid ? "ring-red-500/70" : "ring-transparent",
      )}
    />
  );
}

function Metric({
  label,
  value,
  strong,
  muted,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
  tone?: "warning";
}) {
  return (
    <div>
      <dt className="text-[10px] text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "tabular-nums",
          strong ? "text-base font-semibold" : "text-xs font-medium",
          muted && "text-muted-foreground",
          tone === "warning" && "text-amber-600 dark:text-amber-400",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/** The PATCH response speaks in database columns; the banner speaks in flags. */
function toVerdict(result: Record<string, unknown>): ApprovalVerdictView {
  const levels = new Set(
    Array.isArray(result.required_approvals) ? result.required_approvals : [],
  );

  return {
    blendedRiskScore: typeof result.risk_score === "number" ? result.risk_score : 0,
    needsManager: levels.has("manager"),
    needsFinance: levels.has("finance"),
    needsAdmin: levels.has("admin"),
    requiredApprovals: Array.isArray(result.requiredApprovals)
      ? result.requiredApprovals
      : undefined,
  };
}

/**
 * What the chosen price list actually does — the rule, not just the tier name.
 *
 * A rep switching lists is asking "what will this cost"; naming the rule
 * ("Gold: 10% off base") answers that without them having to open the catalog
 * and compare two numbers.
 */
function priceListHelper(
  tier: CustomerTier,
  priceLists: PriceListEntry[],
): string {
  const entry = priceLists.find(
    (row) => row.tier === tier && row.productId === null,
  );

  return entry
    ? `${TIER_LABELS[tier]}: ${priceRuleSummary(entry)}`
    : `${TIER_LABELS[tier]}: list price unless a product sets its own`;
}

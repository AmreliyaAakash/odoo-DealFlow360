import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeftIcon,
  CurrencyInrIcon,
  PackageIcon,
  StackIcon,
} from "@phosphor-icons/react/dist/ssr";
import {
  CADENCE_MONTHS,
  priceRuleSummary,
  TIER_LABELS,
  type PriceListEntry,
} from "@/lib/business-logic";
import { loadProduct } from "@/lib/catalog-server";
import { requireModule } from "@/lib/page-guard";
import {
  formatCurrency,
  formatNumber,
  formatPercent,
  isSubscription,
} from "@/lib/quotations";
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
 * Screen 17 — one product: what it is, the shapes it ships in, and what each
 * customer tier pays for it.
 *
 * The tier table shows the resolved price beside the rule that produced it.
 * A rule alone ("10% off base") is not something a desk can sanity-check
 * against a customer's expectations; the number it comes out at is.
 */
export default async function ProductDetailPage({
  params,
}: PageProps<"/products/[id]">) {
  const { id } = await params;
  const actor = await requireModule("products");

  const detail = await loadProduct(id);
  if (!detail) notFound();

  const { product, variants, priceLists, tierPricing, onHand } = detail;
  const recurring = isSubscription({
    category: product.category,
    cadence: product.cadence,
  });
  const margin =
    product.listPrice > 0
      ? (product.listPrice - product.cost) / product.listPrice
      : null;

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4">
      <PageHeader
        title={product.name}
        caption={`${product.category}${product.sku ? ` · ${product.sku}` : ""}`}
        badge={product.active ? "Active" : "Archived"}
      >
        <Link
          href="/products"
          className="flex h-8 items-center gap-1.5 rounded-lg bg-muted px-3 text-xs font-medium transition-colors hover:bg-muted/70"
        >
          <ArrowLeftIcon size={13} />
          Catalog
        </Link>
        {actor.canWrite ? (
          <Link
            href="/backend/products"
            className="flex h-8 items-center rounded-lg bg-muted px-3 text-xs font-medium transition-colors hover:bg-muted/70"
          >
            Edit fields
          </Link>
        ) : null}
      </PageHeader>

      <Panel>
        <PanelHeader
          icon={PackageIcon}
          title="General info"
          caption={product.description ?? "No description on file."}
        />

        <dl className="mt-3 grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <Figure label="Price" value={formatCurrency(product.listPrice)} />
          <Figure label="Cost" value={formatCurrency(product.cost)} />
          <Figure label="Margin" value={formatPercent(margin)} />
          <Figure label="Unit" value={product.unit} />
          <Figure label="Tax" value={`${product.taxPct}%`} />
          <Figure label="Subscription" value={recurring ? "Yes" : "No"} />
          <Figure
            label="Recurring"
            value={
              recurring
                ? `${product.cadence} (${CADENCE_MONTHS[product.cadence]}m)`
                : "—"
            }
          />
          <Figure label="Quantity on hand" value={formatNumber(onHand)} />
        </dl>

        {recurring ? (
          <div className="mt-3">
            <Notice>
              A recurring order with this product is invoiced at the beginning of
              each period, on its own invoice — never merged with the one-time
              lines it was sold alongside.
            </Notice>
          </div>
        ) : null}
      </Panel>

      <Panel delay={80}>
        <PanelHeader
          icon={StackIcon}
          title="Variants"
          caption="Attributes the customer chooses, and what each adds to the price"
        />

        <div className="mt-3">
          <DataTable
            minWidth="36rem"
            head={
              <>
                <Th>Attribute</Th>
                <Th>Values</Th>
                <Th className="w-32 text-right">Extra price</Th>
              </>
            }
          >
            {variants.map((variant) => (
              <Tr key={variant.id}>
                <Td className="font-medium">{variant.attribute}</Td>
                <Td className="text-muted-foreground">
                  {variant.values.join(", ") || "—"}
                </Td>
                <Td className="text-right tabular-nums">
                  {variant.extraPrice === 0
                    ? "—"
                    : `+${formatCurrency(variant.extraPrice)}`}
                </Td>
              </Tr>
            ))}

            {variants.length === 0 ? (
              <EmptyRow colSpan={3}>
                This product ships in one shape — no variants.
              </EmptyRow>
            ) : null}
          </DataTable>
        </div>
      </Panel>

      <Panel delay={140}>
        <PanelHeader
          icon={CurrencyInrIcon}
          title="Price lists"
          caption="What each tier pays before any discount the rep negotiates"
        />

        <div className="mt-3">
          <DataTable
            minWidth="40rem"
            head={
              <>
                <Th>Tier</Th>
                <Th className="w-24">Currency</Th>
                <Th>Price rule</Th>
                <Th className="w-24">Scope</Th>
                <Th className="w-32 text-right">Resolved</Th>
              </>
            }
          >
            {tierPricing.map(({ tier, price }) => {
              // The entry that actually decided this tier's price: a rule
              // written for this product beats the catalogue-wide one.
              const specific = priceLists.find(
                (entry) => entry.tier === tier && entry.productId !== null,
              );
              const fallback = priceLists.find(
                (entry) => entry.tier === tier && entry.productId === null,
              );
              const applied = specific ?? fallback;

              return (
                <Tr key={tier}>
                  <Td className="font-medium">{TIER_LABELS[tier]}</Td>
                  <Td className="text-muted-foreground">
                    {applied?.currency ?? "INR"}
                  </Td>
                  <Td className="text-muted-foreground">
                    {applied
                      ? priceRuleSummary(applied as PriceListEntry)
                      : "Base price"}
                  </Td>
                  <Td className="text-[11px] text-muted-foreground">
                    {specific ? "This product" : applied ? "Catalog" : "—"}
                  </Td>
                  <Td className="text-right font-medium tabular-nums">
                    {formatCurrency(price)}
                  </Td>
                </Tr>
              );
            })}
          </DataTable>
        </div>
      </Panel>
    </main>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium capitalize tabular-nums">{value}</dd>
    </div>
  );
}

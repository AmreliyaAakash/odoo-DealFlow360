import Link from "next/link";
import { PackageIcon } from "@phosphor-icons/react/dist/ssr";
import { loadCatalog } from "@/lib/catalog-server";
import { requireModule } from "@/lib/page-guard";
import { formatCurrency, formatNumber } from "@/lib/quotations";
import { schemaGap } from "@/lib/schema-gap";
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
import { SchemaGapNotice } from "@/components/dashboard/schema-gap-notice";

/** Screen 16 — the catalogue, with the depth behind each row summarised. */
export default async function ProductsPage() {
  const actor = await requireModule("products");
  const catalog = await loadCatalog();
  const gap = schemaGap({ message: catalog.error ?? undefined });

  const active = catalog.products.filter((product) => product.active);
  const archived = catalog.products.length - active.length;

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4">
      <PageHeader
        title="Product catalog"
        caption="Every product, variant and price list in one place"
        badge={`${catalog.products.length} products`}
      >
        {actor.canWrite ? (
          <Link
            href="/backend/products"
            className="flex h-8 items-center rounded-lg bg-zinc-900 px-3 text-xs font-medium text-zinc-50 transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            + New product
          </Link>
        ) : null}
      </PageHeader>

      {/* Missing catalog-depth structure is a setup step, not a fault: name
          the file to run instead of relaying the Postgres string. */}
      {catalog.error ? (
        gap ? (
          <SchemaGapNotice gap={gap} />
        ) : (
          <Notice tone="danger">{catalog.error}</Notice>
        )
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Total products"
          value={formatNumber(catalog.products.length)}
          hint={`${active.length} active, ${archived} archived`}
        />
        <Stat
          label="Price lists"
          value={formatNumber(catalog.priceListCount)}
          hint="Tier and currency combinations in force"
        />
        <Stat
          label="Variants"
          value={formatNumber(catalog.variantCount)}
          hint="Attributes across all products"
        />
      </div>

      <Panel delay={120}>
        <PanelHeader
          icon={PackageIcon}
          title="Catalog"
          caption="Click a product to open its general info, variants and price lists"
        />

        <div className="mt-3">
          <DataTable
            minWidth="56rem"
            head={
              <>
                <Th>Product name</Th>
                <Th className="w-32">Category</Th>
                <Th className="w-28 text-right">Price</Th>
                <Th className="w-20">Unit</Th>
                <Th className="w-16 text-right">Tax</Th>
                <Th className="w-36">Variants</Th>
                <Th className="w-24">Status</Th>
              </>
            }
          >
            {catalog.products.map((product, index) => (
              <Tr
                key={product.id}
                className={cn("df-rise-in", !product.active && "opacity-50")}
                style={{ "--df-delay": `${Math.min(index * 25, 400)}ms` } as React.CSSProperties}
              >
                <Td className="font-medium">
                  <Link
                    href={`/products/${product.id}`}
                    className="hover:text-indigo-600 dark:hover:text-indigo-400"
                  >
                    {product.name}
                  </Link>
                  {product.promoted ? (
                    <span className="ml-1.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                      Promo
                    </span>
                  ) : null}
                </Td>
                <Td className="text-muted-foreground">{product.category}</Td>
                <Td className="text-right font-medium tabular-nums">
                  {formatCurrency(product.listPrice)}
                </Td>
                <Td className="text-muted-foreground">{product.unit}</Td>
                <Td className="text-right tabular-nums text-muted-foreground">
                  {product.taxPct}%
                </Td>
                <Td className="text-muted-foreground">{product.variantSummary}</Td>
                <Td className="text-[11px] text-muted-foreground">
                  {product.active ? "Active" : "Archived"}
                </Td>
              </Tr>
            ))}

            {catalog.products.length === 0 ? (
              <EmptyRow colSpan={7}>No products in the catalog.</EmptyRow>
            ) : null}
          </DataTable>
        </div>
      </Panel>
    </main>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <Panel className="p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      <p className="text-[11px] text-muted-foreground">{hint}</p>
    </Panel>
  );
}

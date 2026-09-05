"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PackageIcon } from "@phosphor-icons/react";
import { formatCurrency, type Product } from "@/lib/quotations";
import { cn } from "@/lib/utils";
import { UpsellPanel } from "@/components/UpsellPanel";
import { Panel, PanelHeader } from "@/components/dashboard/panel";

export function UpsellSuggestionsBrowser({ products }: { products: Product[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);

  // A cart of one: this screen explores what pairs with a single product, so the
  // margin figure is that product's own rather than a deal's blended move.
  const cart = useMemo(
    () => (selected ? [{ productId: selected, qty: 1, discountPct: 0 }] : []),
    [selected],
  );

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Panel className="lg:col-span-2">
        <PanelHeader
          icon={PackageIcon}
          title="Catalog"
          caption={`${products.length} products`}
        />

        <div className="mt-3 flex flex-col gap-1">
          {products.map((product, index) => (
            <button
              key={product.id}
              type="button"
              onClick={() => setSelected(product.id)}
              style={{ "--df-delay": `${index * 25}ms` } as React.CSSProperties}
              className={cn(
                "df-rise-in flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors",
                selected === product.id
                  ? "bg-indigo-500/10 ring-1 ring-indigo-500/40"
                  : "hover:bg-muted",
              )}
            >
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium">
                  {product.name}
                </span>
                <span className="block text-[11px] text-muted-foreground">
                  {product.category}
                  {product.sku ? ` · ${product.sku}` : ""}
                </span>
              </span>
              <span className="shrink-0 text-xs font-medium tabular-nums">
                {formatCurrency(product.list_price)}
              </span>
            </button>
          ))}

          {products.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-muted-foreground">
              No products in the catalog.
            </p>
          ) : null}
        </div>
      </Panel>

      {/* No quotation is open on this screen, so accepting a suggestion opens a
          builder that already holds it rather than silently doing nothing. */}
      <UpsellPanel
        lines={cart}
        onAddToQuote={(productId) =>
          router.push(`/quotations/new?product=${encodeURIComponent(productId)}`)
        }
      />
    </div>
  );
}

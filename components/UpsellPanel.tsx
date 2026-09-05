"use client";

import { useEffect, useState } from "react";
import { SparkleIcon } from "@phosphor-icons/react";
import type { UpsellSuggestion } from "@/app/api/upsell/route";
import { Panel, PanelHeader } from "@/components/dashboard/panel";

/** B5 — suggestions for the selected product. */
export function UpsellPanel({
  productId,
  onAddToQuote,
}: {
  productId: string | null;
  onAddToQuote: (productId: string) => void;
}) {
  // Keyed by the product they were fetched for, so switching products clears the
  // stale list without a reset-in-effect.
  const [fetched, setFetched] = useState<{
    productId: string;
    items: UpsellSuggestion[];
  } | null>(null);

  const suggestions =
    productId && fetched?.productId === productId ? fetched.items : [];

  useEffect(() => {
    if (!productId) return;

    let cancelled = false;

    // TODO(B5): surface loading and error states.
    fetch(`/api/upsell?productId=${encodeURIComponent(productId)}`)
      .then((response) => response.json())
      .then((body) => {
        if (!cancelled) {
          setFetched({ productId, items: body.suggestions ?? [] });
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [productId]);

  return (
    <Panel delay={120} className="self-start">
      <PanelHeader
        icon={SparkleIcon}
        title="Suggested add-ons"
        caption={productId ? "Ranked by margin impact" : "Select a product first"}
      />

      <div className="mt-3 flex flex-col gap-2">
        {suggestions.map((suggestion) => (
          <div
            key={suggestion.productId}
            className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-muted"
          >
            <div className="min-w-0">
              <p className="truncate text-xs font-medium">{suggestion.name}</p>
              <p className="text-[11px] text-muted-foreground">
                <span
                  className={
                    suggestion.marginDelta >= 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-red-600 dark:text-red-400"
                  }
                >
                  {suggestion.marginDelta >= 0 ? "+" : ""}
                  {(suggestion.marginDelta * 100).toFixed(1)}% margin
                </span>
                {suggestion.reason ? ` · ${suggestion.reason}` : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onAddToQuote(suggestion.productId)}
              className="shrink-0 rounded-lg bg-indigo-500 px-2.5 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-indigo-400"
            >
              Add
            </button>
          </div>
        ))}

        {suggestions.length === 0 ? (
          <p className="py-6 text-center text-[11px] text-muted-foreground">
            {productId ? "No suggestions yet." : "Pick a product from the catalog."}
          </p>
        ) : null}
      </div>
    </Panel>
  );
}

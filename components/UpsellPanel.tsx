"use client";

import { useEffect, useMemo, useState } from "react";
import { SparkleIcon } from "@phosphor-icons/react";
import type { UpsellSuggestion } from "@/lib/business-logic";
import { formatCurrency, type QuotationLineInput } from "@/lib/quotations";
import { Panel, PanelHeader } from "@/components/dashboard/panel";

/**
 * B5 — suggestions for the cart as it currently stands.
 *
 * Scored against the whole quotation rather than the last product picked, so the
 * margin figure on each row is the real move to the deal's blended margin. That
 * is also why the list re-ranks when the rep changes a discount somewhere else:
 * a suggestion that lifted margin on a clean quote may not lift it on a deeply
 * discounted one.
 */
export function UpsellPanel({
  lines,
  onAddToQuote,
}: {
  lines: QuotationLineInput[];
  onAddToQuote: (productId: string) => void;
}) {
  // The cart reduced to what actually changes a suggestion. Comparing this
  // string is what keeps a re-render from refetching.
  const cartKey = useMemo(
    () =>
      lines
        .filter((line) => line.productId && line.qty > 0)
        .map((line) => `${line.productId}:${line.qty}:${line.discountPct}`)
        .join("|"),
    [lines],
  );

  // Keyed by the cart they were fetched for, so a stale list is never shown
  // beside a cart it does not describe.
  const [fetched, setFetched] = useState<{
    key: string;
    items: UpsellSuggestion[];
    error: string | null;
  } | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);

  useEffect(() => {
    if (cartKey === "") return;

    let cancelled = false;

    // Debounced: a rep dragging a quantity should not fire a request per
    // keystroke, and the panel is advisory enough to trail the cart slightly.
    const timer = setTimeout(() => {
      const body = JSON.stringify({
        lines: lines
          .filter((line) => line.productId && line.qty > 0)
          .map((line) => ({
            productId: line.productId,
            qty: line.qty,
            discountPct: line.discountPct,
            unitPrice: line.unitPrice ?? null,
          })),
      });

      fetch("/api/upsell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      })
        .then(async (response) => ({ ok: response.ok, body: await response.json() }))
        .then(({ ok, body: payload }) => {
          if (cancelled) return;
          setFetched({
            key: cartKey,
            items: ok ? (payload.suggestions ?? []) : [],
            error: ok ? null : (payload.error ?? "Could not load suggestions"),
          });
        })
        .catch(() => {
          if (!cancelled) {
            setFetched({ key: cartKey, items: [], error: "Could not load suggestions" });
          }
        });
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `lines` is read inside, but `cartKey` is what decides whether the answer
    // would differ — re-running on every array identity would refetch forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartKey]);

  const current = fetched?.key === cartKey ? fetched : null;
  const loading = cartKey !== "" && current === null;
  const suggestions = (current?.items ?? []).filter(
    (item) => !dismissed.includes(item.productId),
  );

  return (
    <Panel delay={120} className="self-start">
      <PanelHeader
        icon={SparkleIcon}
        title="Suggested add-ons"
        caption={
          cartKey === ""
            ? "Add a product first"
            : loading
              ? "Scoring against this deal..."
              : "Ranked by fit and margin impact"
        }
      />

      <div className="mt-3 flex flex-col gap-2">
        {suggestions.map((suggestion) => (
          <div
            key={suggestion.productId}
            className="df-rise-in flex items-start justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-muted"
          >
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-xs font-medium">
                <span className="truncate">{suggestion.name}</span>
                {suggestion.promoted ? (
                  <span className="shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                    Promo
                  </span>
                ) : null}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {formatCurrency(suggestion.listPrice)} ·{" "}
                <span
                  className={
                    suggestion.marginDelta >= 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-red-600 dark:text-red-400"
                  }
                >
                  {suggestion.marginDelta >= 0 ? "+" : ""}
                  {(suggestion.marginDelta * 100).toFixed(1)}pp margin
                </span>
                {suggestion.reason ? ` · ${suggestion.reason}` : ""}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => onAddToQuote(suggestion.productId)}
                className="rounded-lg bg-indigo-500 px-2.5 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-indigo-400"
              >
                Add
              </button>
              <button
                type="button"
                onClick={() =>
                  setDismissed((current) => [...current, suggestion.productId])
                }
                className="rounded-lg px-2 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted"
              >
                Dismiss
              </button>
            </div>
          </div>
        ))}

        {suggestions.length === 0 ? (
          <p className="py-6 text-center text-[11px] text-muted-foreground">
            {current?.error ??
              (cartKey === ""
                ? "Pick a product to see what pairs with it."
                : loading
                  ? "Looking for add-ons..."
                  : "Nothing worth suggesting on this deal.")}
          </p>
        ) : null}
      </div>
    </Panel>
  );
}

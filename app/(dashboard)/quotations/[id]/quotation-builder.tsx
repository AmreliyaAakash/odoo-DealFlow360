"use client";

import { useMemo, useState } from "react";
import {
  CheckCircleIcon,
  PackageIcon,
  PlusIcon,
  ReceiptIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import type { RequiredApproval } from "@/lib/business-logic";
import {
  formatCurrency,
  formatPercent,
  summarize,
  type Product,
  type QuotationLineInput,
} from "@/lib/quotations";
import { cn } from "@/lib/utils";
import { QuoteLineRow } from "@/components/QuoteLineRow";
import {
  DataTable,
  EmptyRow,
  Notice,
  Panel,
  PanelHeader,
  Th,
} from "@/components/dashboard/panel";

export type CatalogGroup = { category: string; items: Product[] };

type ConfirmResponse = {
  id: string;
  status: string;
  requiredApprovals: RequiredApproval[];
};

export function QuotationBuilder({
  quotationId,
  catalog,
}: {
  quotationId: string;
  catalog: CatalogGroup[];
}) {
  const [lines, setLines] = useState<QuotationLineInput[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ConfirmResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const productsById = useMemo(
    () => new Map(catalog.flatMap((group) => group.items).map((p) => [p.id, p])),
    [catalog],
  );

  const summary = useMemo(
    () => summarize(lines, productsById),
    [lines, productsById],
  );

  function addLine(productId: string) {
    setResult(null);
    setLines((current) => {
      const existing = current.findIndex((line) => line.productId === productId);
      if (existing !== -1) {
        return current.map((line, index) =>
          index === existing ? { ...line, qty: line.qty + 1 } : line,
        );
      }
      return [...current, { productId, qty: 1, discountPct: 0 }];
    });
  }

  function updateLine(productId: string, patch: Partial<QuotationLineInput>) {
    setResult(null);
    setLines((current) =>
      current.map((line) =>
        line.productId === productId ? { ...line, ...patch } : line,
      ),
    );
  }

  function removeLine(productId: string) {
    setResult(null);
    setLines((current) => current.filter((line) => line.productId !== productId));
  }

  async function confirm() {
    setSubmitting(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch(`/api/quotations/${quotationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines, submit: true }),
      });

      const body = await response.json();

      if (!response.ok) {
        setError(body?.error ?? "Could not confirm this quotation.");
        return;
      }

      setResult(body as ConfirmResponse);
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Panel className="self-start xl:order-2">
        <PanelHeader
          icon={PackageIcon}
          title="Catalog"
          caption={`${productsById.size} products`}
        />

        <div className="mt-3 flex max-h-[32rem] flex-col gap-3 overflow-y-auto">
          {catalog.map((group) => (
            <div key={group.category}>
              <p className="px-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                {group.category}
              </p>
              <div className="mt-1 flex flex-col gap-0.5">
                {group.items.map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => addLine(product.id)}
                    className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium">
                        {product.name}
                      </span>
                      <span className="block text-[11px] tabular-nums text-muted-foreground">
                        {formatCurrency(product.list_price)}
                      </span>
                    </span>
                    <PlusIcon
                      size={13}
                      weight="bold"
                      className="shrink-0 text-muted-foreground"
                    />
                  </button>
                ))}
              </div>
            </div>
          ))}

          {catalog.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              No products available.
            </p>
          ) : null}
        </div>
      </Panel>

      <div className="flex flex-col gap-4 xl:col-span-2">
        {result ? <ApprovalBanner result={result} /> : null}
        {error ? <Notice tone="danger">{error}</Notice> : null}

        <Panel delay={80}>
          <PanelHeader
            icon={ReceiptIcon}
            title="Quotation lines"
            caption={`${lines.length} line${lines.length === 1 ? "" : "s"}`}
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
              {lines.map((line, index) => {
                const product = productsById.get(line.productId);
                if (!product) return null;

                return (
                  <QuoteLineRow
                    key={line.productId}
                    product={product}
                    line={line}
                    index={index}
                    onChange={(patch) => updateLine(line.productId, patch)}
                    onRemove={() => removeLine(line.productId)}
                  />
                );
              })}

              {lines.length === 0 ? (
                <EmptyRow colSpan={8}>
                  Add a product from the catalog to start building this quotation.
                </EmptyRow>
              ) : null}
            </DataTable>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t border-border/60 pt-4">
            <dl className="flex flex-wrap gap-6">
              <Metric label="Gross" value={formatCurrency(summary.gross)} />
              <Metric
                label="Discount"
                value={`-${formatCurrency(summary.discount)}`}
                tone="negative"
              />
              <Metric label="Total" value={formatCurrency(summary.net)} strong />
              <Metric
                label="Margin"
                value={`${formatCurrency(summary.margin)} · ${formatPercent(summary.marginPct)}`}
                tone={
                  summary.marginPct !== null && summary.marginPct < 0.15
                    ? "warning"
                    : undefined
                }
              />
            </dl>

            <button
              type="button"
              onClick={confirm}
              disabled={submitting || lines.length === 0}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-xs font-medium text-zinc-50 transition-colors hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {submitting ? "Confirming..." : "Confirm quotation"}
            </button>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function ApprovalBanner({ result }: { result: ConfirmResponse }) {
  const approvals = result.requiredApprovals;

  if (approvals.length === 0) {
    return (
      <div className="flex items-start gap-2 rounded-xl bg-emerald-500/10 p-3 text-xs text-emerald-700 ring-1 ring-emerald-500/30 dark:text-emerald-400">
        <CheckCircleIcon size={15} weight="fill" className="mt-px shrink-0" />
        <p className="font-medium">Confirmed — no approvals required.</p>
      </div>
    );
  }

  const levels = [...new Set(approvals.map((a) => a.level))];

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-amber-500/10 p-3 text-xs ring-1 ring-amber-500/30">
      <div className="flex flex-wrap items-center gap-2 text-amber-700 dark:text-amber-400">
        <WarningCircleIcon size={15} weight="fill" className="shrink-0" />
        <p className="font-medium">
          Confirmed — awaiting approval from {formatLevels(levels)}.
        </p>
        {levels.map((level) => (
          <span
            key={level}
            className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-medium capitalize"
          >
            {level}
          </span>
        ))}
      </div>
      <ul className="flex flex-col gap-0.5 pl-6 text-muted-foreground">
        {approvals.map((approval) => (
          <li key={`${approval.level}:${approval.reason}`}>
            <span className="capitalize">{approval.level}</span>: {approval.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Metric({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: "negative" | "warning";
}) {
  return (
    <div>
      <dt className="text-[10px] text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "tabular-nums",
          strong ? "text-base font-semibold" : "text-xs font-medium",
          tone === "negative" && "text-muted-foreground",
          tone === "warning" && "text-amber-600 dark:text-amber-400",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function formatLevels(levels: string[]): string {
  return new Intl.ListFormat("en-IN", {
    style: "long",
    type: "conjunction",
  }).format(levels);
}

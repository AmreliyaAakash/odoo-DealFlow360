"use client";

import { useMemo, useState } from "react";
import type { RequiredApproval } from "@/lib/business-logic";
import {
  formatCurrency,
  formatPercent,
  lineTotals,
  summarize,
  type Product,
  type QuotationLineInput,
} from "@/lib/quotations";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <section className="flex flex-col gap-4 lg:w-80 lg:shrink-0">
        {catalog.map((group) => (
          <Card key={group.category}>
            <CardHeader>
              <CardTitle>{group.category}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1">
              {group.items.map((product) => (
                <div
                  key={product.id}
                  className="flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium">{product.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatCurrency(product.list_price)}
                      {product.sku ? ` · ${product.sku}` : ""}
                    </p>
                  </div>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => addLine(product.id)}
                  >
                    Add
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
        {catalog.length === 0 ? (
          <p className="text-sm text-muted-foreground">No products available.</p>
        ) : null}
      </section>

      <section className="flex min-w-0 flex-1 flex-col gap-4">
        {result ? <ApprovalBanner result={result} /> : null}
        {error ? (
          <p className="border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead className="w-24 text-right">Unit</TableHead>
              <TableHead className="w-20">Qty</TableHead>
              <TableHead className="w-24">Disc %</TableHead>
              <TableHead className="w-28 text-right">Net</TableHead>
              <TableHead className="w-24 text-right">Margin</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line) => {
              const product = productsById.get(line.productId);
              if (!product) return null;
              const totals = lineTotals(product, line);

              return (
                <TableRow key={line.productId}>
                  <TableCell className="font-medium">{product.name}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(product.list_price)}
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min={1}
                      step={1}
                      value={line.qty}
                      onChange={(event) =>
                        updateLine(line.productId, {
                          qty: clamp(event.target.valueAsNumber, 1, Infinity, 1),
                        })
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={line.discountPct}
                      onChange={(event) =>
                        updateLine(line.productId, {
                          discountPct: clamp(event.target.valueAsNumber, 0, 100, 0),
                        })
                      }
                    />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(totals.net)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(totals.margin)}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`Remove ${product.name}`}
                      onClick={() => removeLine(line.productId)}
                    >
                      &times;
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {lines.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground">
                  Add a product to start building this quotation.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>

        <div className="flex flex-wrap items-center justify-between gap-4 border-t pt-4">
          <dl className="flex flex-wrap gap-6 text-sm">
            <Metric label="Gross" value={formatCurrency(summary.gross)} />
            <Metric
              label="Discount"
              value={`-${formatCurrency(summary.discount)}`}
            />
            <Metric label="Total" value={formatCurrency(summary.net)} />
            <Metric
              label="Margin"
              value={`${formatCurrency(summary.margin)} (${formatPercent(summary.marginPct)})`}
            />
          </dl>

          <Button onClick={confirm} disabled={submitting || lines.length === 0}>
            {submitting ? "Confirming…" : "Confirm"}
          </Button>
        </div>
      </section>
    </div>
  );
}

function ApprovalBanner({ result }: { result: ConfirmResponse }) {
  if (result.requiredApprovals.length === 0) {
    return (
      <div className="border border-border bg-muted p-3 text-sm">
        <p className="font-medium">Confirmed — no approvals required.</p>
      </div>
    );
  }

  const levels = [...new Set(result.requiredApprovals.map((a) => a.level))];

  return (
    <div className="flex flex-col gap-2 border border-border bg-muted p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium">
          Confirmed — awaiting approval from {formatLevels(levels)}.
        </p>
        {levels.map((level) => (
          <Badge key={level} variant="secondary">
            {level}
          </Badge>
        ))}
      </div>
      <ul className="list-disc pl-5 text-muted-foreground">
        {result.requiredApprovals.map((approval) => (
          <li key={`${approval.level}:${approval.reason}`}>
            <span className="capitalize">{approval.level}</span>: {approval.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function formatLevels(levels: string[]): string {
  return new Intl.ListFormat("en-IN", {
    style: "long",
    type: "conjunction",
  }).format(levels);
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (Number.isNaN(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

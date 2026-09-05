"use client";

import { TrashIcon } from "@phosphor-icons/react";
import {
  formatCurrency,
  lineTotals,
  unitPriceFor,
  type Product,
  type QuotationLineInput,
} from "@/lib/quotations";
import { Td, Tr } from "@/components/dashboard/panel";
import { DiscountBadge } from "@/components/dashboard/status-badge";

/**
 * One line of a quotation (B3): qty, discount %, and the resulting net and
 * margin. Editable in the builder, read-only wherever a signed quote is shown.
 *
 * The callbacks are optional because a Server Component cannot pass a function
 * across the boundary at all — not even a no-op. A read-only caller omits them,
 * and nothing here calls them in that mode: the quantity and discount inputs are
 * `readOnly`, and the remove button is not rendered.
 */
export function QuoteLineRow({
  product,
  line,
  index = 0,
  onChange,
  onRemove,
  readOnly = false,
}: {
  product: Product;
  line: QuotationLineInput;
  index?: number;
  onChange?: (patch: Partial<QuotationLineInput>) => void;
  onRemove?: () => void;
  readOnly?: boolean;
}) {
  const totals = lineTotals(product, line);
  const thin = totals.net > 0 && totals.margin / totals.net < 0.15;

  return (
    <Tr
      className="df-rise-in"
      style={{ "--df-delay": `${index * 40}ms` } as React.CSSProperties}
    >
      <Td className="font-medium">
        <span className="block">{product.name}</span>
        <span className="block text-[11px] text-muted-foreground">
          {product.category}
          {product.sku ? ` · ${product.sku}` : ""}
        </span>
      </Td>
      <Td className="text-right tabular-nums">
        {formatCurrency(unitPriceFor(product, line))}
      </Td>
      <Td>
        <NumberField
          value={line.qty}
          min={1}
          max={Infinity}
          readOnly={readOnly}
          label={`Quantity for ${product.name}`}
          onChange={(qty) => onChange?.({ qty })}
        />
      </Td>
      <Td>
        <NumberField
          value={line.discountPct}
          min={0}
          max={100}
          readOnly={readOnly}
          label={`Discount for ${product.name}`}
          onChange={(discountPct) => onChange?.({ discountPct })}
        />
      </Td>
      <Td className="text-right">
        <DiscountBadge value={line.discountPct} />
      </Td>
      <Td className="text-right font-medium tabular-nums">
        {formatCurrency(totals.net)}
      </Td>
      <Td className="text-right tabular-nums">
        <span
          className={
            thin ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"
          }
        >
          {formatCurrency(totals.margin)}
        </span>
      </Td>
      <Td>
        {readOnly ? null : (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${product.name}`}
            className="text-muted-foreground transition-colors hover:text-destructive"
          >
            <TrashIcon size={14} />
          </button>
        )}
      </Td>
    </Tr>
  );
}

function NumberField({
  value,
  min,
  max,
  label,
  readOnly,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  label: string;
  readOnly: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <input
      type="number"
      min={min}
      max={Number.isFinite(max) ? max : undefined}
      step={1}
      value={value}
      readOnly={readOnly}
      aria-label={label}
      onChange={(event) => onChange(clamp(event.target.valueAsNumber, min, max))}
      className="h-7 w-16 rounded-lg bg-muted/60 px-2 text-right text-xs tabular-nums outline-none ring-1 ring-transparent transition focus-visible:bg-background focus-visible:ring-indigo-500"
    />
  );
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

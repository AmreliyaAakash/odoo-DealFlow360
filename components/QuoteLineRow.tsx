"use client";

import {
  formatCurrency,
  lineTotals,
  type Product,
  type QuotationLineInput,
} from "@/lib/quotations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableCell, TableRow } from "@/components/ui/table";

/**
 * One editable line in the quotation builder (B3): qty, discount %, and the
 * resulting net and margin.
 */
export function QuoteLineRow({
  product,
  line,
  onChange,
  onRemove,
  readOnly = false,
}: {
  product: Product;
  line: QuotationLineInput;
  onChange: (patch: Partial<QuotationLineInput>) => void;
  onRemove: () => void;
  readOnly?: boolean;
}) {
  const totals = lineTotals(product, line);

  return (
    <TableRow>
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
          readOnly={readOnly}
          onChange={(event) =>
            onChange({ qty: clamp(event.target.valueAsNumber, 1, Infinity, 1) })
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
          readOnly={readOnly}
          onChange={(event) =>
            onChange({ discountPct: clamp(event.target.valueAsNumber, 0, 100, 0) })
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
        {readOnly ? null : (
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={`Remove ${product.name}`}
            onClick={onRemove}
          >
            &times;
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (Number.isNaN(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

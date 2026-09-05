/** Shared quotation shapes and pricing math, used by the builder UI and the API. */

export type Product = {
  id: string;
  name: string;
  sku: string | null;
  category: string;
  list_price: number;
  cost: number;
};

export type QuotationLineInput = {
  productId: string;
  qty: number;
  discountPct: number;
};

export type LineTotals = {
  gross: number;
  discount: number;
  net: number;
  cost: number;
  margin: number;
};

export type QuotationSummary = LineTotals & {
  /** Margin as a fraction of net revenue, or `null` when net is zero. */
  marginPct: number | null;
  /** Deepest per-line discount in the quotation, as a percentage. */
  maxDiscountPct: number;
  lineCount: number;
};

export function lineTotals(product: Product, line: QuotationLineInput): LineTotals {
  const gross = product.list_price * line.qty;
  const discount = gross * (line.discountPct / 100);
  const net = gross - discount;
  const cost = product.cost * line.qty;

  return { gross, discount, net, cost, margin: net - cost };
}

export function summarize(
  lines: QuotationLineInput[],
  products: Map<string, Product>,
): QuotationSummary {
  const summary = lines.reduce<QuotationSummary>(
    (acc, line) => {
      const product = products.get(line.productId);
      if (!product) return acc;

      const totals = lineTotals(product, line);

      return {
        gross: acc.gross + totals.gross,
        discount: acc.discount + totals.discount,
        net: acc.net + totals.net,
        cost: acc.cost + totals.cost,
        margin: acc.margin + totals.margin,
        marginPct: null,
        maxDiscountPct: Math.max(acc.maxDiscountPct, line.discountPct),
        lineCount: acc.lineCount + 1,
      };
    },
    {
      gross: 0,
      discount: 0,
      net: 0,
      cost: 0,
      margin: 0,
      marginPct: null,
      maxDiscountPct: 0,
      lineCount: 0,
    },
  );

  return {
    ...summary,
    marginPct: summary.net === 0 ? null : summary.margin / summary.net,
  };
}

/**
 * Money is Indian rupees throughout. `en-IN` also gives the lakh/crore digit
 * grouping (12,34,567) rather than western thousands.
 */
export const LOCALE = "en-IN";
export const CURRENCY = "INR";

const currency = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: CURRENCY,
  maximumFractionDigits: 0,
});

export function formatCurrency(value: number): string {
  return currency.format(value);
}

/** Compact money for chart axes: ₹7.1L, ₹1.2Cr. */
export function formatCompactCurrency(value: number): string {
  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency: CURRENCY,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatPercent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

/** Plain integers with Indian grouping, for counts. */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 }).format(value);
}

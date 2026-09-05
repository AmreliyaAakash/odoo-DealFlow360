/** Shared quotation shapes and pricing math, used by the builder UI and the API. */

export type Product = {
  id: string;
  name: string;
  sku: string | null;
  category: string;
  list_price: number;
  cost: number;
  /** Billing rhythm. Anything but `one_time` makes the product a subscription. */
  cadence?: BillingCadence;
};

/** Columns every product query needs for the shapes in this module to be whole. */
export const PRODUCT_COLUMNS = "id, name, sku, category, list_price, cost, cadence";

export type BillingCadence = "one_time" | "monthly" | "quarterly" | "annual";

/**
 * The three buckets the quotation builder groups the catalog into.
 *
 * Derived rather than stored: `products.category` is free text the admin owns
 * (Servers, Networking, Support…), and pinning the builder to a fixed list would
 * mean a new category silently disappearing from it. Cadence decides
 * subscription because that is what actually makes a line recur.
 */
export const PRODUCT_KINDS = ["hardware", "service", "subscription"] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];

export const PRODUCT_KIND_LABELS: Record<ProductKind, string> = {
  hardware: "Hardware",
  service: "Service",
  subscription: "Subscription",
};

/** Categories that are work rather than goods. Matched case-insensitively. */
const SERVICE_CATEGORIES = new Set(["services", "service", "professional services"]);

/** The little of a product that decides its kind and its discount ceiling. */
export type ProductFacts = Pick<Product, "category" | "cadence"> &
  Partial<Pick<Product, "id" | "sku">>;

export function productKind(product: ProductFacts): ProductKind {
  if (product.cadence && product.cadence !== "one_time") return "subscription";
  if (SERVICE_CATEGORIES.has(product.category.toLowerCase())) return "service";
  return "hardware";
}

export function isSubscription(product: ProductFacts): boolean {
  return productKind(product) === "subscription";
}

export type QuotationLineInput = {
  productId: string;
  qty: number;
  discountPct: number;
  /** Chosen billing cycle. Set only on subscription lines. */
  subscriptionPlanId?: string | null;
  /**
   * Negotiated unit price, overriding the catalog list price.
   *
   * Reps are allowed to move price as well as discount, so this is a real input
   * rather than a display value — but `cost` is never taken from the client, so
   * an override still shows up honestly as margin erosion and still trips the
   * approval rules. Omit or null to quote at list.
   */
  unitPrice?: number | null;
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

/** The price this line actually quotes: the rep's override, else list price. */
export function unitPriceFor(product: Product, line: QuotationLineInput): number {
  const override = line.unitPrice;
  return typeof override === "number" && Number.isFinite(override) && override >= 0
    ? override
    : product.list_price;
}

export function lineTotals(product: Product, line: QuotationLineInput): LineTotals {
  const gross = unitPriceFor(product, line) * line.qty;
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

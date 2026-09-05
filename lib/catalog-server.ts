import "server-only";
import {
  asCadence,
  priceForTier,
  type BillingCadence,
  type CustomerTier,
  type PriceListEntry,
  type PriceRule,
} from "@/lib/business-logic";
import { createServerSupabaseClient } from "@/lib/supabase-server";

/**
 * A2 — the catalogue with its depth: variants and tier pricing.
 *
 * Kept apart from `backend-entities`, which drives the generic config tables.
 * A product is the one record in this system with a screen of its own, and
 * squeezing variants and price lists through a field-list abstraction built for
 * flat rows would cost more than writing the two queries.
 */

export type CatalogProduct = {
  id: string;
  name: string;
  sku: string | null;
  category: string;
  listPrice: number;
  cost: number;
  unit: string;
  taxPct: number;
  description: string | null;
  cadence: BillingCadence;
  promoted: boolean;
  active: boolean;
  variantCount: number;
  /** Attributes, so the list can say "3 (Size)" without a second query. */
  variantSummary: string;
};

export type Variant = {
  id: string;
  attribute: string;
  values: string[];
  extraPrice: number;
  position: number;
};

export type PriceListRow = {
  id: string;
  productId: string | null;
  tier: CustomerTier;
  currency: string;
  rule: PriceRule;
  amount: number;
  active: boolean;
};

export type CatalogSummary = {
  products: CatalogProduct[];
  /** Distinct tier/currency combinations in force. */
  priceListCount: number;
  variantCount: number;
  error: string | null;
};

type RawProduct = {
  id: string;
  name: string;
  sku: string | null;
  category: string;
  list_price: number;
  cost: number;
  unit: string;
  tax_pct: number;
  description: string | null;
  cadence: string;
  promoted: boolean;
  active: boolean;
};

const PRODUCT_SELECT =
  "id, name, sku, category, list_price, cost, unit, tax_pct, description, cadence, promoted, active";

export async function loadCatalog(): Promise<CatalogSummary> {
  const supabase = createServerSupabaseClient();

  const [productResult, variantResult, priceResult] = await Promise.all([
    supabase
      .from("products")
      .select(PRODUCT_SELECT)
      .order("category", { ascending: true })
      .order("name", { ascending: true })
      .returns<RawProduct[]>(),
    supabase
      .from("product_variants")
      .select("product_id, attribute, values")
      .returns<{ product_id: string; attribute: string; values: string[] }[]>(),
    supabase
      .from("price_lists")
      .select("tier, currency")
      .eq("active", true)
      .returns<{ tier: string; currency: string }[]>(),
  ]);

  const failure =
    productResult.error ?? variantResult.error ?? priceResult.error;

  // Attributes per product, so the list column reads "3 (RAM, Rails)" rather
  // than a bare count the admin has to open the product to understand.
  const byProduct = new Map<string, { attribute: string; values: string[] }[]>();
  for (const row of variantResult.data ?? []) {
    const list = byProduct.get(row.product_id) ?? [];
    list.push({ attribute: row.attribute, values: row.values });
    byProduct.set(row.product_id, list);
  }

  const products = (productResult.data ?? []).map((row) => {
    const variants = byProduct.get(row.id) ?? [];

    return {
      id: row.id,
      name: row.name,
      sku: row.sku,
      category: row.category,
      listPrice: Number(row.list_price),
      cost: Number(row.cost),
      unit: row.unit,
      taxPct: Number(row.tax_pct),
      description: row.description,
      cadence: asCadence(row.cadence),
      promoted: row.promoted,
      active: row.active,
      variantCount: variants.length,
      variantSummary:
        variants.length === 0
          ? "—"
          : `${variants.length} (${variants.map((v) => v.attribute).join(", ")})`,
    } satisfies CatalogProduct;
  });

  const combos = new Set(
    (priceResult.data ?? []).map((row) => `${row.tier}:${row.currency}`),
  );

  return {
    products,
    priceListCount: combos.size,
    variantCount: variantResult.data?.length ?? 0,
    error: failure?.message ?? null,
  };
}

export type ProductDetail = {
  product: CatalogProduct;
  variants: Variant[];
  priceLists: PriceListRow[];
  /** What each tier pays before any negotiated discount. */
  tierPricing: { tier: CustomerTier; price: number }[];
  /** Units on hand across every active warehouse. */
  onHand: number;
};

export async function loadProduct(id: string): Promise<ProductDetail | null> {
  const supabase = createServerSupabaseClient();

  const { data: row, error } = await supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("id", id)
    .maybeSingle<RawProduct>();

  if (error || !row) return null;

  const [variantResult, priceResult, stockResult] = await Promise.all([
    supabase
      .from("product_variants")
      .select("id, attribute, values, extra_price, position")
      .eq("product_id", id)
      .order("position", { ascending: true })
      .returns<
        {
          id: string;
          attribute: string;
          values: string[];
          extra_price: number;
          position: number;
        }[]
      >(),
    // Catalogue-wide rules matter here too: a tier with no product-specific
    // entry still has a price, and hiding the rule that sets it would make the
    // resolved figure below look like it came from nowhere.
    supabase
      .from("price_lists")
      .select("id, product_id, tier, currency, rule, amount, active")
      .or(`product_id.eq.${id},product_id.is.null`)
      .eq("active", true)
      .returns<
        {
          id: string;
          product_id: string | null;
          tier: CustomerTier;
          currency: string;
          rule: PriceRule;
          amount: number;
          active: boolean;
        }[]
      >(),
    supabase
      .from("warehouse_stock")
      .select("available, warehouses(active)")
      .eq("product_id", id)
      .returns<{ available: number; warehouses: { active: boolean } | null }[]>(),
  ]);

  const product: CatalogProduct = {
    id: row.id,
    name: row.name,
    sku: row.sku,
    category: row.category,
    listPrice: Number(row.list_price),
    cost: Number(row.cost),
    unit: row.unit,
    taxPct: Number(row.tax_pct),
    description: row.description,
    cadence: asCadence(row.cadence),
    promoted: row.promoted,
    active: row.active,
    variantCount: variantResult.data?.length ?? 0,
    variantSummary: "",
  };

  const priceLists: PriceListRow[] = (priceResult.data ?? []).map((entry) => ({
    id: entry.id,
    productId: entry.product_id,
    tier: entry.tier,
    currency: entry.currency,
    rule: entry.rule,
    amount: Number(entry.amount),
    active: entry.active,
  }));

  const entries: PriceListEntry[] = priceLists.map((entry) => ({
    productId: entry.productId,
    tier: entry.tier,
    currency: entry.currency,
    rule: entry.rule,
    amount: entry.amount,
  }));

  const tiers: CustomerTier[] = ["standard", "silver", "gold", "platinum"];

  return {
    product,
    variants: (variantResult.data ?? []).map((entry) => ({
      id: entry.id,
      attribute: entry.attribute,
      values: entry.values,
      extraPrice: Number(entry.extra_price),
      position: entry.position,
    })),
    priceLists,
    tierPricing: tiers.map((tier) => ({
      tier,
      price: priceForTier(
        { id: product.id, list_price: product.listPrice },
        tier,
        entries,
      ),
    })),
    onHand: (stockResult.data ?? [])
      .filter((entry) => entry.warehouses?.active)
      .reduce((sum, entry) => sum + Number(entry.available), 0),
  };
}

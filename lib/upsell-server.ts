import "server-only";
import {
  rankUpsellSuggestions,
  type UpsellCandidate,
  type UpsellSuggestion,
} from "@/lib/business-logic";
import {
  PRODUCT_COLUMNS,
  type Product,
  type QuotationLineInput,
} from "@/lib/quotations";
import { createServerSupabaseClient } from "@/lib/supabase-server";

/**
 * B5 / A6 — assembling upsell candidates.
 *
 * Two sources, deliberately: the rules table is the desk stating what pairs with
 * what, and past quotations are what customers actually did. Neither alone is
 * enough — rules go stale and history has no opinion about a product nobody has
 * quoted yet — so a candidate found by both outranks one found by either, which
 * falls out of the scoring rather than needing a special case.
 *
 * The ranking itself is in `business-logic`; this module only feeds it.
 */

type Supabase = ReturnType<typeof createServerSupabaseClient>;

/** Quotations scanned for co-purchase pairs. Enough signal without a table scan. */
const HISTORY_LIMIT = 400;

/** Suggestions returned to the panel. More than this is a list nobody reads. */
const MAX_SUGGESTIONS = 6;

type RuleRow = {
  suggested_product_id: string;
  trigger_product_id: string | null;
  trigger_category: string | null;
  priority: number | null;
  min_margin_pct: number | null;
};

export async function suggestUpsells(
  lines: QuotationLineInput[],
): Promise<UpsellSuggestion[] | { error: string }> {
  const cart = lines.filter((line) => line.qty > 0);
  const cartIds = [...new Set(cart.map((line) => line.productId))];
  if (cartIds.length === 0) return [];

  const supabase = createServerSupabaseClient();

  const { data: cartProducts, error: cartError } = await supabase
    .from("products")
    .select(PRODUCT_COLUMNS)
    .in("id", cartIds)
    .returns<Product[]>();

  if (cartError) return { error: cartError.message };

  const products = new Map((cartProducts ?? []).map((row) => [row.id, row]));
  const cartCategories = [
    ...new Set((cartProducts ?? []).map((row) => row.category)),
  ];

  const [rules, coPurchases] = await Promise.all([
    matchingRules(supabase, cartIds, cartCategories),
    coPurchaseCounts(supabase, cartIds),
  ]);

  if ("error" in rules) return rules;
  if ("error" in coPurchases) return coPurchases;

  // Everything either source named, minus what is already in the cart.
  const candidateIds = [
    ...new Set([...rules.byProduct.keys(), ...coPurchases.keys()]),
  ].filter((id) => !cartIds.includes(id));

  if (candidateIds.length === 0) return [];

  const { data: candidateProducts, error: candidateError } = await supabase
    .from("products")
    .select(`${PRODUCT_COLUMNS}, promoted`)
    .in("id", candidateIds)
    .eq("active", true)
    .returns<(Product & { promoted: boolean })[]>();

  if (candidateError) return { error: candidateError.message };

  const candidates: UpsellCandidate[] = (candidateProducts ?? []).map((product) => {
    const rule = rules.byProduct.get(product.id);

    return {
      product,
      rulePriority: rule ? (rule.priority ?? 100) : null,
      coPurchaseCount: coPurchases.get(product.id) ?? 0,
      promoted: product.promoted,
      // Stored as a percentage, scored as a fraction.
      minMargin:
        rule?.min_margin_pct === null || rule?.min_margin_pct === undefined
          ? null
          : Number(rule.min_margin_pct) / 100,
    };
  });

  return rankUpsellSuggestions(cart, products, candidates).slice(0, MAX_SUGGESTIONS);
}

/**
 * Rules triggered by anything in the cart — by the exact product, or by its
 * category so the desk can write "anything in Hardware pairs with onsite support"
 * once instead of per SKU.
 *
 * When several rules name the same product, the keenest priority wins; the rest
 * would only ever score lower.
 */
async function matchingRules(
  supabase: Supabase,
  cartIds: string[],
  categories: string[],
): Promise<{ byProduct: Map<string, RuleRow> } | { error: string }> {
  const filters = [`trigger_product_id.in.(${cartIds.join(",")})`];
  if (categories.length > 0) {
    // Quoted, because a category is free text and may contain a comma.
    filters.push(
      `trigger_category.in.(${categories.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")})`,
    );
  }

  const { data, error } = await supabase
    .from("upsell_rules")
    .select(
      "suggested_product_id, trigger_product_id, trigger_category, priority, min_margin_pct",
    )
    .eq("active", true)
    .or(filters.join(","))
    .returns<RuleRow[]>();

  if (error) return { error: error.message };

  const byProduct = new Map<string, RuleRow>();
  for (const rule of data ?? []) {
    const existing = byProduct.get(rule.suggested_product_id);
    if (!existing || (rule.priority ?? 100) < (existing.priority ?? 100)) {
      byProduct.set(rule.suggested_product_id, rule);
    }
  }

  return { byProduct };
}

/**
 * How often each product has been quoted alongside something in this cart.
 *
 * Counted per quotation, not per line: a product on three lines of one quote is
 * one co-purchase, not three, or a deal with many line items would drown out the
 * pattern across the rest of the book.
 */
async function coPurchaseCounts(
  supabase: Supabase,
  cartIds: string[],
): Promise<Map<string, number> | { error: string }> {
  const { data: containing, error: containingError } = await supabase
    .from("quotation_lines")
    .select("quotation_id")
    .in("product_id", cartIds)
    .limit(HISTORY_LIMIT)
    .returns<{ quotation_id: string }[]>();

  if (containingError) return { error: containingError.message };

  const quotationIds = [...new Set((containing ?? []).map((row) => row.quotation_id))];
  if (quotationIds.length === 0) return new Map();

  const { data: siblings, error: siblingError } = await supabase
    .from("quotation_lines")
    .select("quotation_id, product_id")
    .in("quotation_id", quotationIds)
    .returns<{ quotation_id: string; product_id: string }[]>();

  if (siblingError) return { error: siblingError.message };

  const seen = new Set<string>();
  const counts = new Map<string, number>();

  for (const row of siblings ?? []) {
    if (cartIds.includes(row.product_id)) continue;

    const key = `${row.quotation_id}:${row.product_id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    counts.set(row.product_id, (counts.get(row.product_id) ?? 0) + 1);
  }

  return counts;
}

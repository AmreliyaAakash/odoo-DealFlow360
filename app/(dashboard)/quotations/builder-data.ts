import "server-only";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import type { DiscountRule, PriceListEntry } from "@/lib/business-logic";
import { canWith, effectiveAccess, scopeWith } from "@/lib/permissions-server";
import { PRODUCT_COLUMNS, type Product } from "@/lib/quotations";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import type { CustomerOption, SubscriptionPlan } from "./quotation-form";

/**
 * Everything the builder needs to render, loaded once and shared by the create
 * page and the edit page so the two cannot drift apart — a ceiling shown at
 * /new and a different one shown at /[id] would be worse than no ceiling.
 */
export type BuilderData = {
  customers: CustomerOption[];
  catalog: Product[];
  plans: SubscriptionPlan[];
  discountRules: DiscountRule[];
  /** Tier pricing, so the builder can re-price a cart the way the catalog does. */
  priceLists: PriceListEntry[];
};

export async function loadBuilderData(): Promise<BuilderData> {
  const supabase = createServerSupabaseClient();

  const customersPromise = (async () => {
    const res = await supabase
      .from("customers")
      .select("id, name, tier")
      .order("name", { ascending: true })
      .returns<CustomerOption[]>();

    if (!res.error) return res;

    // Fallback if 'tier' column does not exist yet in the database
    const fallback = await supabase
      .from("customers")
      .select("id, name")
      .order("name", { ascending: true });

    if (fallback.error) return res;

    return {
      data: (fallback.data ?? []).map((c: { id: string; name: string | null }) => ({
        id: c.id,
        name: c.name,
        tier: "standard",
      })),
      error: null,
    };
  })();

  const productsPromise = supabase
    .from("products")
    .select(PRODUCT_COLUMNS)
    .eq("active", true)
    .order("category", { ascending: true })
    .order("name", { ascending: true })
    .returns<Product[]>();

  const plansPromise = supabase
    .from("subscription_plans")
    .select("id, name, cadence, unit_price")
    .eq("active", true)
    .order("unit_price", { ascending: true })
    .returns<SubscriptionPlan[]>();

  const rulesPromise = (async () => {
    const res = await supabase
      .from("discount_rules")
      .select("scope, scope_ref, customer_tier, max_discount_pct")
      .eq("active", true)
      .returns<DiscountRule[]>();

    if (!res.error) return res;

    // Fallback if 'customer_tier' column does not exist yet in the database
    const fallback = await supabase
      .from("discount_rules")
      .select("scope, scope_ref, max_discount_pct")
      .eq("active", true);

    if (fallback.error) return res;

    return {
      data: (fallback.data ?? []).map((r: { scope: string; scope_ref: string | null; max_discount_pct: number }) => ({
        scope: r.scope,
        scope_ref: r.scope_ref,
        customer_tier: null,
        max_discount_pct: r.max_discount_pct,
      })),
      error: null,
    };
  })();

  const priceListsPromise = (async () => {
    const res = await supabase
      .from("price_lists")
      .select("product_id, tier, currency, rule, amount")
      .eq("active", true)
      .returns<
        {
          product_id: string | null;
          tier: PriceListEntry["tier"];
          currency: string;
          rule: PriceListEntry["rule"];
          amount: number;
        }[]
      >();

    if (!res.error) return res;

    // Fallback if price_lists table doesn't exist yet
    return { data: [], error: null };
  })();

  const [customers, products, plans, rules, priceLists] = await Promise.all([
    customersPromise,
    productsPromise,
    plansPromise,
    rulesPromise,
    priceListsPromise,
  ]);

  const failure =
    customers.error ??
    products.error ??
    plans.error ??
    rules.error ??
    priceLists.error ??
    null;
  if (failure) {
    throw new Error(`Failed to load the quotation builder: ${failure.message}`);
  }

  return {
    customers: customers.data ?? [],
    catalog: products.data ?? [],
    plans: plans.data ?? [],
    discountRules: rules.data ?? [],
    priceLists: (priceLists.data ?? []).map((entry) => ({
      productId: entry.product_id,
      tier: entry.tier,
      currency: entry.currency,
      rule: entry.rule,
      amount: Number(entry.amount),
    })),
  };
}

export type BuilderActor = {
  userId: string;
  role: string | null;
  scope: ReturnType<typeof scopeWith>;
  canWrite: boolean;
  /** Whether the fulfilment split may be read, and whether it may be committed. */
  canViewSplit: boolean;
  canCommitSplit: boolean;
  /** Whether the order and its invoices may be read, and orders raised. */
  canViewBilling: boolean;
  canWriteBilling: boolean;
  /**
   * Whether this account may post into a customer conversation at all.
   *
   * Reading the thread is not gated on this — a manager or finance user sees
   * every thread through `quotationBuilder` — but writing into one is the
   * portal module, which only a rep and the customer hold. The caller must
   * still check that the quotation is theirs.
   */
  canMessage: boolean;
};

/**
 * Guards a builder page and reports what the caller may do there.
 *
 * `view` gets you the screen; only `write` gets you an editable form, which is
 * how an approver can open a quotation to read it without being handed the
 * controls to change it.
 */
export async function requireBuilderAccess(): Promise<BuilderActor> {
  const { userId, role } = await currentUser();
  if (!userId) redirect("/sign-in");

  const { access } = await effectiveAccess(userId, role);
  if (!canWith(access, "quotationBuilder", "view")) redirect("/unauthorized");

  return {
    userId,
    role,
    scope: scopeWith(access, "quotationBuilder"),
    canWrite: canWith(access, "quotationBuilder", "write"),
    canViewSplit: canWith(access, "warehouseSplit", "view"),
    canCommitSplit: canWith(access, "warehouseSplit", "write"),
    canViewBilling: canWith(access, "billing", "view"),
    canWriteBilling: canWith(access, "billing", "write"),
    canMessage: canWith(access, "customerPortal", "write"),
  };
}

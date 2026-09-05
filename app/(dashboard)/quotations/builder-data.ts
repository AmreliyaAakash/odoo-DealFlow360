import "server-only";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import type { DiscountRule } from "@/lib/business-logic";
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
};

export async function loadBuilderData(): Promise<BuilderData> {
  const supabase = createServerSupabaseClient();

  const [customers, products, plans, rules] = await Promise.all([
    supabase
      .from("customers")
      .select("id, name, tier")
      .order("name", { ascending: true })
      .returns<CustomerOption[]>(),
    supabase
      .from("products")
      .select(PRODUCT_COLUMNS)
      .eq("active", true)
      .order("category", { ascending: true })
      .order("name", { ascending: true })
      .returns<Product[]>(),
    supabase
      .from("subscription_plans")
      .select("id, name, cadence, unit_price")
      .eq("active", true)
      .order("unit_price", { ascending: true })
      .returns<SubscriptionPlan[]>(),
    supabase
      .from("discount_rules")
      .select("scope, scope_ref, customer_tier, max_discount_pct")
      .eq("active", true)
      .returns<DiscountRule[]>(),
  ]);

  const failure =
    customers.error ?? products.error ?? plans.error ?? rules.error ?? null;
  if (failure) {
    throw new Error(`Failed to load the quotation builder: ${failure.message}`);
  }

  return {
    customers: customers.data ?? [],
    catalog: products.data ?? [],
    plans: plans.data ?? [],
    discountRules: rules.data ?? [],
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
  };
}

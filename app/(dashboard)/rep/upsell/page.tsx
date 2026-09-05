import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import type { Product } from "@/lib/quotations";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { Notice, PageHeader } from "@/components/dashboard/panel";
import { UpsellSuggestionsBrowser } from "./upsell-browser";

/** B5 — rep-facing view over the upsell engine. */
export default async function UpsellSuggestionsPage() {
  // Per-user page: reading auth up front also marks the route dynamic, so Next
  // does not try to prerender it and trip Supabase's realtime token setup.
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }

  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from("products")
    .select("id, name, sku, category, list_price, cost")
    .order("category", { ascending: true })
    .order("name", { ascending: true })
    .returns<Product[]>();

  const products = data ?? [];

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4">
      <PageHeader
        title="Upsell Suggestions"
        caption="Pick a product to see what pairs well with it"
        badge={`${products.length} products`}
      />

      {error ? <Notice>Could not load products: {error.message}</Notice> : null}

      <UpsellSuggestionsBrowser products={products} />
    </main>
  );
}

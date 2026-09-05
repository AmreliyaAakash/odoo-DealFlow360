import { notFound } from "next/navigation";
import { QuotationBuilder } from "./quotation-builder";
import type { Product } from "@/lib/quotations";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { PageHeader } from "@/components/dashboard/panel";
import { StatusBadge } from "@/components/dashboard/status-badge";

type Quotation = {
  id: string;
  reference: string | null;
  status: string | null;
  customers: { name: string | null } | null;
};

export default async function QuotationPage({
  params,
}: PageProps<"/quotations/[id]">) {
  const { id } = await params;
  const supabase = createServerSupabaseClient();

  const [quotationResult, productsResult] = await Promise.all([
    supabase
      .from("quotations")
      .select("id, reference, status, customers(name)")
      .eq("id", id)
      .maybeSingle<Quotation>(),
    supabase
      .from("products")
      .select("id, name, sku, category, list_price, cost")
      .order("category", { ascending: true })
      .order("name", { ascending: true })
      .returns<Product[]>(),
  ]);

  if (quotationResult.error) {
    throw new Error(`Failed to load quotation: ${quotationResult.error.message}`);
  }
  if (!quotationResult.data) {
    notFound();
  }
  if (productsResult.error) {
    throw new Error(`Failed to load products: ${productsResult.error.message}`);
  }

  const quotation = quotationResult.data;
  const catalog = groupByCategory(productsResult.data ?? []);

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4">
      <PageHeader
        title={quotation.reference ?? `Quotation ${quotation.id}`}
        caption={quotation.customers?.name ?? "Unassigned customer"}
      >
        <StatusBadge status={quotation.status ?? "draft"} />
      </PageHeader>

      <QuotationBuilder quotationId={quotation.id} catalog={catalog} />
    </main>
  );
}

function groupByCategory(products: Product[]) {
  const byCategory = new Map<string, Product[]>();

  for (const product of products) {
    const category = product.category || "Uncategorized";
    const existing = byCategory.get(category);
    if (existing) {
      existing.push(product);
    } else {
      byCategory.set(category, [product]);
    }
  }

  return [...byCategory.entries()].map(([category, items]) => ({ category, items }));
}

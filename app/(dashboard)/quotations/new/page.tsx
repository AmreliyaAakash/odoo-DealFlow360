import { redirect } from "next/navigation";
import { PageHeader } from "@/components/dashboard/panel";
import { loadBuilderData, requireBuilderAccess } from "../builder-data";
import { QuotationForm } from "../quotation-form";

/** B3 — raise a new quotation. */
export default async function NewQuotationPage({
  searchParams,
}: PageProps<"/quotations/new">) {
  const actor = await requireBuilderAccess();

  // Reading the builder is not raising a quote: an approver who lands here is
  // sent back to the pipeline rather than shown a form they cannot submit.
  if (!actor.canWrite) redirect("/quotations");

  const data = await loadBuilderData();

  // ?product=<id> seeds the first line, so accepting a suggestion from the
  // browse screen opens a builder that already holds it. Checked against the
  // catalog rather than trusted, so a stale link opens an empty form instead of
  // a line pointing at nothing.
  const requested = (await searchParams).product;
  const initialProductId =
    typeof requested === "string" &&
    data.catalog.some((product) => product.id === requested)
      ? requested
      : undefined;

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4">
      <PageHeader
        title="New quotation"
        caption="Pick the customer, build the lines, and see what it needs before you send it"
        badge="Draft"
      />

      <QuotationForm
        customers={data.customers}
        catalog={data.catalog}
        plans={data.plans}
        discountRules={data.discountRules}
        priceLists={data.priceLists}
        initialProductId={initialProductId}
      />
    </main>
  );
}

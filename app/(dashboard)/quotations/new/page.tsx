import { redirect } from "next/navigation";
import { PageHeader } from "@/components/dashboard/panel";
import { loadBuilderData, requireBuilderAccess } from "../builder-data";
import { QuotationForm } from "../quotation-form";

/** B3 — raise a new quotation. */
export default async function NewQuotationPage() {
  const actor = await requireBuilderAccess();

  // Reading the builder is not raising a quote: an approver who lands here is
  // sent back to the pipeline rather than shown a form they cannot submit.
  if (!actor.canWrite) redirect("/quotations");

  const data = await loadBuilderData();

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
      />
    </main>
  );
}

import { redirect } from "next/navigation";
import { PageHeader } from "@/components/dashboard/panel";
import { loadBuilderData, requireBuilderAccess } from "../builder-data";
import { QuotationForm, type SeededLine } from "../quotation-form";

/** B3 — raise a new quotation. */
export default async function NewQuotationPage({
  searchParams,
}: PageProps<"/quotations/new">) {
  const actor = await requireBuilderAccess();

  // Reading the builder is not raising a quote: an approver who lands here is
  // sent back to the pipeline rather than shown a form they cannot submit.
  if (!actor.canWrite) redirect("/quotations");

  const data = await loadBuilderData();

  const params = await searchParams;

  // ?product=<id> seeds the first line, so accepting a suggestion from the
  // browse screen opens a builder that already holds it. Checked against the
  // catalog rather than trusted, so a stale link opens an empty form instead of
  // a line pointing at nothing.
  const requested = params.product;
  const initialProductId =
    typeof requested === "string" &&
    data.catalog.some((product) => product.id === requested)
      ? requested
      : undefined;

  // ?customer=<id>&line=<productId>:<qty>:<discountPct> seeds a whole quote, so
  // the assistant's prepared draft opens as a form somebody reviews and submits
  // rather than as text they retype. Every part is validated against the same
  // catalog and customer list the form renders from — a link is a thing anyone
  // can edit, so nothing in it is trusted, and no price comes from the URL.
  const requestedCustomer = params.customer;
  const initialCustomerId =
    typeof requestedCustomer === "string" &&
    data.customers.some((customer) => customer.id === requestedCustomer)
      ? requestedCustomer
      : undefined;

  const initialLines = parseSeededLines(params.line, data.catalog);

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
        initialCustomerId={initialCustomerId}
        initialLines={initialLines}
      />
    </main>
  );
}

/** How many seeded lines a link may carry, so a crafted URL cannot balloon the form. */
const MAX_SEEDED_LINES = 20;

/**
 * `line=<productId>:<qty>:<discountPct>`, repeatable.
 *
 * Every field is bounded and every product checked, because this arrives in a
 * URL: quantity is clamped to something a form can hold, discount to 0–100, and
 * an unknown product id is dropped rather than seeded. The unit price is never
 * read from here — the form takes it from the catalog.
 */
function parseSeededLines(
  value: string | string[] | undefined,
  catalog: { id: string }[],
): SeededLine[] {
  const raw = value === undefined ? [] : Array.isArray(value) ? value : [value];

  return raw.slice(0, MAX_SEEDED_LINES).flatMap((entry) => {
    const [productId, qty, discount] = entry.split(":");
    if (!productId || !catalog.some((product) => product.id === productId)) return [];

    const quantity = Number(qty);
    const discountPct = Number(discount);

    return [
      {
        productId,
        qty: Number.isFinite(quantity) && quantity > 0 ? Math.min(quantity, 100_000) : 1,
        discountPct:
          Number.isFinite(discountPct) && discountPct > 0
            ? Math.min(discountPct, 100)
            : 0,
      },
    ];
  });
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr";
import { asCadence, CADENCE_MONTHS, type BillingLine } from "@/lib/business-logic";
import { requireModule } from "@/lib/page-guard";
import { formatCurrency } from "@/lib/quotations";
import { loadSubscription } from "@/lib/subscriptions-server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { BillingScreen } from "@/components/BillingScreen";
import { PageHeader } from "@/components/dashboard/panel";
import { SubscriptionControls } from "./subscription-controls";

/**
 * Screen 10 — billing detail for one subscription.
 *
 * It shows the whole order the subscription came from, not just the recurring
 * line: the customer bought a server and a support plan on one document, and a
 * screen that hid the server would leave finance reconciling against something
 * the customer never saw. One-time and recurring stay in separate tables, which
 * is the rule the invoicing follows too.
 */
export default async function SubscriptionDetailPage({
  params,
}: PageProps<"/subscriptions/[id]">) {
  const { id } = await params;
  const actor = await requireModule("billing");

  const subscription = await loadSubscription(id);
  if (!subscription) notFound();

  const lines = await orderLines(subscription.quotationId);

  // The period the proration maths is measured against: this cycle, stepping
  // from the day the subscription started.
  const periodStart = new Date(subscription.startedAt);
  const periodEnd = new Date(periodStart);
  periodEnd.setMonth(periodEnd.getMonth() + CADENCE_MONTHS[subscription.cadence]);

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4">
      <PageHeader
        title={`${subscription.customerName} — ${subscription.planName ?? subscription.productName}`}
        caption={`${subscription.cadence} · ${formatCurrency(subscription.mrr)} per month`}
        badge={subscription.status}
      >
        <Link
          href="/subscriptions"
          className="flex h-8 items-center gap-1.5 rounded-lg bg-muted px-3 text-xs font-medium transition-colors hover:bg-muted/70"
        >
          <ArrowLeftIcon size={13} />
          Subscriptions
        </Link>
      </PageHeader>

      <SubscriptionControls
        subscriptionId={subscription.id}
        status={subscription.status}
        canWrite={actor.canWrite}
      />

      <BillingScreen
        lines={lines}
        periodStart={periodStart}
        periodEnd={periodEnd}
      />
    </main>
  );
}

/**
 * Every line on the originating quotation, shaped for the billing view. Prices
 * are the snapshot taken when the quote was won, not today's catalogue.
 */
async function orderLines(quotationId: string | null): Promise<BillingLine[]> {
  if (!quotationId) return [];

  const supabase = createServerSupabaseClient();

  const { data } = await supabase
    .from("quotation_lines")
    .select("id, qty, unit_price, discount_pct, products(name, cadence)")
    .eq("quotation_id", quotationId)
    .returns<
      {
        id: string;
        qty: number;
        unit_price: number;
        discount_pct: number;
        products: { name: string | null; cadence: string | null } | null;
      }[]
    >();

  return (data ?? []).map((line) => ({
    id: line.id,
    name: line.products?.name ?? "Item",
    cadence: asCadence(line.products?.cadence ?? null),
    qty: Number(line.qty),
    // Net of the discount the customer actually agreed, so the billing figures
    // match the invoice rather than the catalogue.
    unitPrice:
      Number(line.unit_price) * (1 - Number(line.discount_pct) / 100),
  }));
}

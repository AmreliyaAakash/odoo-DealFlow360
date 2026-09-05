import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr";
import { requireModule } from "@/lib/page-guard";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import {
  ALLOCATABLE_STATUSES,
  loadSplitForQuotation,
} from "@/lib/warehouse-split-server";
import { Notice, PageHeader } from "@/components/dashboard/panel";
import { WarehouseSplitView } from "@/components/WarehouseSplitView";

/**
 * Screen 8 — the warehouse split for one order.
 *
 * The same component the quotation page shows, on its own address. Fulfilment
 * is a job somebody does from a queue of orders, not something you go looking
 * for inside a quote — and the queue's rows have to lead somewhere.
 */
export default async function FulfillmentDetailPage({
  params,
}: PageProps<"/fulfillment/[id]">) {
  const { id } = await params;
  const actor = await requireModule("warehouseSplit");
  const supabase = createServerSupabaseClient();

  const { data: quotation, error } = await supabase
    .from("quotations")
    .select("id, reference, status, rep_id, requested_delivery_date, customers(name)")
    .eq("id", id)
    .maybeSingle<{
      id: string;
      reference: string | null;
      status: string | null;
      rep_id: string;
      requested_delivery_date: string | null;
      customers: { name: string | null } | null;
    }>();

  if (error) throw new Error(`Failed to load the order: ${error.message}`);
  if (!quotation) notFound();

  // A rep allocates their own orders and no one else's, the same rule the API
  // applies. RLS would return nothing anyway; this makes it a 404 rather than
  // an empty screen with no explanation.
  if (actor.scope === "own" && quotation.rep_id !== actor.userId) notFound();

  const status = quotation.status ?? "draft";
  const allocatable = ALLOCATABLE_STATUSES.has(status);
  const split = allocatable ? await loadSplitForQuotation(quotation.id) : null;

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4">
      <PageHeader
        title={`Fulfillment — ${quotation.reference ?? quotation.id.slice(0, 8)}`}
        caption={
          quotation.requested_delivery_date
            ? `${quotation.customers?.name ?? "Unassigned customer"} · delivery requested by ${quotation.requested_delivery_date}`
            : (quotation.customers?.name ?? "Unassigned customer")
        }
        badge={status.replace(/_/g, " ")}
      >
        <Link
          href="/fulfillment"
          className="flex h-8 items-center gap-1.5 rounded-lg bg-muted px-3 text-xs font-medium transition-colors hover:bg-muted/70"
        >
          <ArrowLeftIcon size={13} />
          Fulfillment
        </Link>
        <Link
          href={`/quotations/${quotation.id}`}
          className="flex h-8 items-center rounded-lg bg-muted px-3 text-xs font-medium transition-colors hover:bg-muted/70"
        >
          Open quotation
        </Link>
      </PageHeader>

      {!allocatable ? (
        <Notice>
          This quotation is {status.replace(/_/g, " ")}. Stock is only reserved once
          the deal is approved — before that there is nothing to fulfil.
        </Notice>
      ) : split && "error" in split ? (
        <Notice tone="danger">Could not load the split: {split.error}</Notice>
      ) : split ? (
        <WarehouseSplitView
          quotationId={quotation.id}
          canCommit={actor.canWrite}
          initial={split}
        />
      ) : null}
    </main>
  );
}

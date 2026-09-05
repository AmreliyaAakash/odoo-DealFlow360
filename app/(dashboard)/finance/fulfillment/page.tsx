import { requireModule } from "@/lib/page-guard";
import { Notice, PageHeader } from "@/components/dashboard/panel";
import { loadFinanceDashboard } from "../data";
import { requireFinance } from "../guard";
import { FulfillmentBillingQueue } from "../queue-tabs";
import { WarehouseStockOverview } from "../warehouse-stock";

/** Fulfilment view: what still needs allocating, and where the stock sits. */
export default async function FulfillmentPage() {
  await requireFinance();
  // The page is the allocation queue, so it is the warehouse-split module that
  // governs it — not the finance role that happens to sit next to it.
  const actor = await requireModule("warehouseSplit");
  const seesStock = actor.can("warehouses", "view");

  const data = await loadFinanceDashboard();
  const outstanding = data.queue.filter((row) => row.splitStatus !== "allocated");

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4">
      <PageHeader
        title="Fulfillment"
        caption={`${outstanding.length} committed quotes still to allocate`}
        badge={`${data.stats.backorderedItems} units short`}
      />

      {data.loadError ? (
        <Notice>Could not load fulfilment data: {data.loadError}</Notice>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-3">
        <div className={seesStock ? "xl:col-span-2" : "xl:col-span-3"}>
          <FulfillmentBillingQueue rows={data.queue} />
        </div>
        {seesStock ? <WarehouseStockOverview rows={data.warehouses} /> : null}
      </div>
    </main>
  );
}

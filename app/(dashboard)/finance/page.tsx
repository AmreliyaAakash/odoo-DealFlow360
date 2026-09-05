import { requireAnyModule } from "@/lib/page-guard";
import { Notice, PageHeader } from "@/components/dashboard/panel";
import { loadFinanceDashboard } from "./data";
import { requireFinance } from "./guard";
import { FinanceStatCards } from "./stat-cards";
import { FulfillmentBillingQueue } from "./queue-tabs";
import { MrrChart } from "./mrr-chart";
import { WarehouseStockOverview } from "./warehouse-stock";

/**
 * Finance home.
 *
 * `requireFinance` keeps sales managers out of the billing queue — that is a
 * role question. Which panels appear is a module question, and the two are not
 * the same: a finance account with `warehouses` revoked should still get its
 * revenue chart, and should not be shown an empty stock panel.
 */
export default async function FinanceDashboardPage() {
  const role = await requireFinance();
  const actor = await requireAnyModule(["billing", "warehouses", "warehouseSplit"]);

  const seesStock = actor.can("warehouses", "view");
  const seesRevenue = actor.can("billing", "view");
  const seesQueue = actor.can("billing", "view") || actor.can("warehouseSplit", "view");

  const data = await loadFinanceDashboard();

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4">
      <PageHeader
        title="Finance dashboard"
        caption="Recurring revenue, fulfilment and what needs signing off"
        badge={role}
      />

      {data.loadError ? (
        <Notice>Could not load finance data: {data.loadError}</Notice>
      ) : null}

      <FinanceStatCards stats={data.stats} />

      {/* Recurring revenue is billing, stock is warehouses. A finance account
          holding only one of them gets that one, full width. */}
      {seesRevenue || seesStock ? (
        <div className="grid gap-4 xl:grid-cols-3">
          {seesRevenue ? (
            <div className={seesStock ? "xl:col-span-2" : "xl:col-span-3"}>
              <MrrChart data={data.mrrTrend} />
            </div>
          ) : null}
          {seesStock ? (
            <div className={seesRevenue ? undefined : "xl:col-span-3"}>
              <WarehouseStockOverview rows={data.warehouses} />
            </div>
          ) : null}
        </div>
      ) : null}

      {seesQueue ? <FulfillmentBillingQueue rows={data.queue} /> : null}
    </main>
  );
}

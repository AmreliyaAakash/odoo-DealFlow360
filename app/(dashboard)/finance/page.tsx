import { Notice, PageHeader } from "@/components/dashboard/panel";
import { loadFinanceDashboard } from "./data";
import { requireFinance } from "./guard";
import { FinanceStatCards } from "./stat-cards";
import { FulfillmentBillingQueue } from "./queue-tabs";
import { MrrChart } from "./mrr-chart";
import { WarehouseStockOverview } from "./warehouse-stock";

/** Finance home. */
export default async function FinanceDashboardPage() {
  const role = await requireFinance();
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

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <MrrChart data={data.mrrTrend} />
        </div>
        <WarehouseStockOverview rows={data.warehouses} />
      </div>

      <FulfillmentBillingQueue rows={data.queue} />
    </main>
  );
}

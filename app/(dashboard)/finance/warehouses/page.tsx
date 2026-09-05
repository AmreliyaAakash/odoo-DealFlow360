import { WarehouseIcon } from "@phosphor-icons/react/dist/ssr";
import { formatNumber } from "@/lib/quotations";
import {
  DataTable,
  EmptyRow,
  Notice,
  PageHeader,
  Panel,
  PanelHeader,
  Td,
  Th,
  Tr,
} from "@/components/dashboard/panel";
import { loadFinanceDashboard } from "../data";
import { requireFinance } from "../guard";
import { WarehouseStockOverview } from "../warehouse-stock";

/** Read-only stock view for finance; editing warehouses stays in the backend. */
export default async function FinanceWarehousesPage() {
  await requireFinance();

  const data = await loadFinanceDashboard();
  const totalOnHand = data.warehouses.reduce((sum, row) => sum + row.onHand, 0);

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4">
      <PageHeader
        title="Warehouses"
        caption={`${formatNumber(totalOnHand)} units on hand across ${data.warehouses.length} sites`}
        badge="Stock"
      />

      {data.loadError ? (
        <Notice>Could not load warehouse data: {data.loadError}</Notice>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-3">
        <Panel className="xl:col-span-2">
          <PanelHeader
            icon={WarehouseIcon}
            title="Stock by site"
            caption="On hand versus units committed to open quotes"
          />

          <div className="mt-3">
            <DataTable
              minWidth="38rem"
              head={
                <>
                  <Th>Warehouse</Th>
                  <Th className="w-24">Code</Th>
                  <Th className="w-28">Region</Th>
                  <Th className="w-28 text-right">On hand</Th>
                  <Th className="w-28 text-right">Committed</Th>
                  <Th className="w-24 text-right">Short</Th>
                </>
              }
            >
              {data.warehouses.map((row, index) => (
                <Tr
                  key={row.warehouseId}
                  className="df-rise-in"
                  style={{ "--df-delay": `${index * 45}ms` } as React.CSSProperties}
                >
                  <Td className="font-medium">{row.name}</Td>
                  <Td className="text-muted-foreground">{row.code}</Td>
                  <Td className="text-muted-foreground">{row.region ?? "—"}</Td>
                  <Td className="text-right font-medium tabular-nums">
                    {formatNumber(row.onHand)}
                  </Td>
                  <Td className="text-right tabular-nums text-muted-foreground">
                    {formatNumber(row.committed)}
                  </Td>
                  <Td className="text-right">
                    {row.shortages > 0 ? (
                      <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium tabular-nums text-amber-600 dark:text-amber-400">
                        {row.shortages}
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">—</span>
                    )}
                  </Td>
                </Tr>
              ))}

              {data.warehouses.length === 0 ? (
                <EmptyRow colSpan={6}>No active warehouses configured.</EmptyRow>
              ) : null}
            </DataTable>
          </div>
        </Panel>

        <WarehouseStockOverview rows={data.warehouses} />
      </div>
    </main>
  );
}

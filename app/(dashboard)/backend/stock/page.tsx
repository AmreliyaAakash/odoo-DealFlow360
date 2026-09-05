import { loadStockBoard } from "@/lib/stock-server";
import { requireModule } from "@/lib/page-guard";
import { PageHeader } from "@/components/dashboard/panel";
import { StockEditor } from "./stock-editor";

/**
 * A5 — warehouse stock levels, and what is below its reorder point.
 *
 * The reorder panel sits above the grid rather than on a screen of its own: it
 * is derived entirely from the numbers below it, and an admin who has just
 * corrected a figure should see the consequence without navigating.
 */
export default async function StockPage() {
  const actor = await requireModule("warehouses");
  const board = await loadStockBoard();

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4">
      <PageHeader
        title="Warehouse stock"
        caption="What each warehouse is holding, and what needs bringing in"
        badge={`${board.warehouses.length} warehouses`}
      />

      <StockEditor board={board} canWrite={actor.canWrite} />
    </main>
  );
}

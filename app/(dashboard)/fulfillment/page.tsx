import Link from "next/link";
import { PackageIcon, TruckIcon } from "@phosphor-icons/react/dist/ssr";
import { requireModule } from "@/lib/page-guard";
import { formatNumber } from "@/lib/quotations";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { cn } from "@/lib/utils";
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

/**
 * Screen 7 — live stock, and every confirmed order still waiting on it.
 *
 * "Reserved" is the quantity already committed to an order, so Available is
 * what a new order can actually be promised. Showing only what is on the shelf
 * is how a warehouse ends up promising the same unit twice.
 */

type StockRow = {
  warehouse_id: string;
  product_id: string;
  available: number;
  warehouses: { name: string; code: string; active: boolean } | null;
  products: { name: string } | null;
};

type OrderRow = {
  id: string;
  reference: string | null;
  status: string | null;
  customers: { name: string | null } | null;
  quotation_lines: { qty: number }[];
  quotation_allocations: {
    qty: number;
    warehouses: { name: string | null } | null;
  }[];
};

export default async function FulfillmentPage() {
  await requireModule("warehouseSplit");
  const supabase = createServerSupabaseClient();

  const [stockResult, orderResult] = await Promise.all([
    supabase
      .from("warehouse_stock")
      .select(
        "warehouse_id, product_id, available, warehouses(name, code, active), products(name)",
      )
      .gt("available", 0)
      .limit(200)
      .returns<StockRow[]>(),
    supabase
      .from("quotations")
      .select(
        `id, reference, status, customers(name),
         quotation_lines(qty),
         quotation_allocations(qty, warehouses(name))`,
      )
      .in("status", ["approved", "won"])
      .order("updated_at", { ascending: false })
      .limit(60)
      .returns<OrderRow[]>(),
  ]);

  const error = stockResult.error?.message ?? orderResult.error?.message ?? null;

  // Reserved per warehouse+product, so the same figure the split engine draws
  // down is the one the desk reads here.
  const reserved = await reservedByShelf(supabase);

  const stock = (stockResult.data ?? [])
    .filter((row) => row.warehouses?.active)
    .map((row) => {
      const key = `${row.warehouse_id}:${row.product_id}`;
      const held = reserved.get(key) ?? 0;

      return {
        key,
        warehouse: row.warehouses?.name ?? "Unknown warehouse",
        product: row.products?.name ?? "Unknown product",
        onHand: Number(row.available) + held,
        reserved: held,
        available: Number(row.available),
      };
    })
    .sort(
      (a, b) =>
        a.warehouse.localeCompare(b.warehouse) || a.product.localeCompare(b.product),
    );

  const orders = (orderResult.data ?? []).map((row) => {
    const ordered = row.quotation_lines.reduce(
      (sum, line) => sum + Number(line.qty),
      0,
    );
    const allocated = row.quotation_allocations.reduce(
      (sum, line) => sum + Number(line.qty),
      0,
    );
    const sites = [
      ...new Set(
        row.quotation_allocations
          .map((line) => line.warehouses?.name)
          .filter((name): name is string => Boolean(name)),
      ),
    ];

    return {
      id: row.id,
      reference: row.reference ?? row.id.slice(0, 8),
      customer: row.customers?.name ?? "Unassigned customer",
      state: splitState(ordered, allocated),
      sites,
    };
  });

  const outstanding = orders.filter((order) => order.state !== "Allocated");

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4">
      <PageHeader
        title="Fulfillment and stock"
        caption={`${outstanding.length} confirmed order(s) still to allocate`}
        badge="Warehouses"
      />

      {error ? <Notice tone="danger">{error}</Notice> : null}

      <Panel delay={60}>
        <PanelHeader
          icon={PackageIcon}
          title="Live stock"
          caption="On hand, reserved against orders, and what is left to promise"
        />

        <div className="mt-3">
          <DataTable
            minWidth="42rem"
            head={
              <>
                <Th>Warehouse</Th>
                <Th>Product</Th>
                <Th className="w-24 text-right">On hand</Th>
                <Th className="w-24 text-right">Reserved</Th>
                <Th className="w-24 text-right">Available</Th>
              </>
            }
          >
            {stock.map((row) => (
              <Tr key={row.key}>
                <Td className="font-medium">{row.warehouse}</Td>
                <Td className="text-muted-foreground">{row.product}</Td>
                <Td className="text-right tabular-nums">{formatNumber(row.onHand)}</Td>
                <Td className="text-right tabular-nums text-muted-foreground">
                  {formatNumber(row.reserved)}
                </Td>
                <Td
                  className={cn(
                    "text-right font-medium tabular-nums",
                    row.available === 0 && "text-red-600 dark:text-red-400",
                  )}
                >
                  {formatNumber(row.available)}
                </Td>
              </Tr>
            ))}

            {stock.length === 0 ? (
              <EmptyRow colSpan={5}>No stock on record.</EmptyRow>
            ) : null}
          </DataTable>
        </div>
      </Panel>

      <Panel delay={140}>
        <PanelHeader
          icon={TruckIcon}
          title="Orders awaiting fulfillment"
          caption="Click an order to open its warehouse split"
        />

        <div className="mt-3">
          <DataTable
            minWidth="40rem"
            head={
              <>
                <Th>Order</Th>
                <Th>Customer</Th>
                <Th className="w-32">Status</Th>
                <Th>Warehouses</Th>
              </>
            }
          >
            {orders.map((order, index) => (
              <Tr
                key={order.id}
                className="df-rise-in"
                style={{ "--df-delay": `${Math.min(index * 30, 400)}ms` } as React.CSSProperties}
              >
                <Td className="font-medium">
                  <Link
                    href={`/fulfillment/${order.id}`}
                    className="hover:text-indigo-600 dark:hover:text-indigo-400"
                  >
                    {order.reference}
                  </Link>
                </Td>
                <Td>{order.customer}</Td>
                <Td>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-medium",
                      order.state === "Allocated" &&
                        "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                      order.state === "Split pending" &&
                        "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                      order.state === "Backorder" &&
                        "bg-red-500/10 text-red-600 dark:text-red-400",
                    )}
                  >
                    {order.state}
                  </span>
                </Td>
                <Td className="text-muted-foreground">
                  {order.sites.length > 0 ? order.sites.join(" + ") : "—"}
                </Td>
              </Tr>
            ))}

            {orders.length === 0 ? (
              <EmptyRow colSpan={4}>Nothing confirmed is waiting on stock.</EmptyRow>
            ) : null}
          </DataTable>
        </div>
      </Panel>
    </main>
  );
}

/** Units committed to an order, per warehouse and product. */
async function reservedByShelf(
  supabase: ReturnType<typeof createServerSupabaseClient>,
) {
  const { data } = await supabase
    .from("quotation_allocations")
    .select("warehouse_id, product_id, qty")
    .returns<{ warehouse_id: string; product_id: string; qty: number }[]>();

  const held = new Map<string, number>();
  for (const row of data ?? []) {
    const key = `${row.warehouse_id}:${row.product_id}`;
    held.set(key, (held.get(key) ?? 0) + Number(row.qty));
  }
  return held;
}

function splitState(ordered: number, allocated: number): string {
  if (ordered > 0 && allocated >= ordered) return "Allocated";
  if (allocated === 0) return "Split pending";
  return "Backorder";
}

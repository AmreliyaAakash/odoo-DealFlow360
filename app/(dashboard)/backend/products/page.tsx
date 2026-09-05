import { ResourceTable, type ResourceField, type ResourceRow } from "@/components/backend/resource-table";

/** A2 — STRUCTURE ONLY. Admin-only; `proxy.ts` gates /backend. */

const FIELDS: ResourceField[] = [
  { key: "name", label: "Name" },
  { key: "sku", label: "SKU" },
  { key: "category", label: "Category" },
  { key: "list_price", label: "List price", type: "number" },
  { key: "cost", label: "Cost", type: "number" },
];

export default async function Page() {
  // TODO(A2): load rows from Supabase.
  const rows: ResourceRow[] = [];

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4">
      <ResourceTable title="Products" fields={FIELDS} rows={rows} />
    </main>
  );
}

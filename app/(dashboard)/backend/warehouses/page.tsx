import { ResourceTable, type ResourceField, type ResourceRow } from "@/components/backend/resource-table";

/** A4 — STRUCTURE ONLY. Admin-only; `proxy.ts` gates /backend. */

const FIELDS: ResourceField[] = [
  { key: "name", label: "Name" },
  { key: "code", label: "Code" },
  { key: "region", label: "Region" },
  { key: "priority", label: "Priority", type: "number" },
];

export default async function Page() {
  // TODO(A4): load rows from Supabase.
  const rows: ResourceRow[] = [];

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4">
      <ResourceTable title="Warehouses" fields={FIELDS} rows={rows} />
    </main>
  );
}

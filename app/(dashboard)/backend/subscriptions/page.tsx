import { ResourceTable, type ResourceField, type ResourceRow } from "@/components/backend/resource-table";

/** A5 — STRUCTURE ONLY. Admin-only; `proxy.ts` gates /backend. */

const FIELDS: ResourceField[] = [
  { key: "name", label: "Name" },
  { key: "cadence", label: "Cadence" },
  { key: "unit_price", label: "Unit price", type: "number" },
  { key: "min_term_months", label: "Min term (months)", type: "number" },
];

export default async function Page() {
  // TODO(A5): load rows from Supabase.
  const rows: ResourceRow[] = [];

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4">
      <ResourceTable title="Subscription plans" fields={FIELDS} rows={rows} />
    </main>
  );
}

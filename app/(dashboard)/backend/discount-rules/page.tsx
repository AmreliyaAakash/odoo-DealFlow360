import { ResourceTable, type ResourceField, type ResourceRow } from "@/components/backend/resource-table";

/** A3 — STRUCTURE ONLY. Admin-only; `proxy.ts` gates /backend. */

const FIELDS: ResourceField[] = [
  { key: "name", label: "Name" },
  { key: "scope", label: "Scope" },
  { key: "max_discount_pct", label: "Max discount %", type: "number" },
  { key: "approval_level", label: "Approval level" },
];

export default async function Page() {
  // TODO(A3): load rows from Supabase.
  const rows: ResourceRow[] = [];

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4">
      <ResourceTable title="Discount rules" fields={FIELDS} rows={rows} />
    </main>
  );
}

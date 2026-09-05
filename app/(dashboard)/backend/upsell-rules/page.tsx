import { redirect } from "next/navigation";
import { currentRole } from "@/lib/auth";
import { canWrite } from "@/lib/permissions";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import {
  ResourceTable,
  type ResourceField,
  type ResourceRow,
} from "@/components/backend/resource-table";

/**
 * Upsell rules — which product to suggest alongside which. Admin-only in the
 * matrix, and re-checked here rather than trusting the route guard alone.
 *
 * STRUCTURE ONLY for editing: rows are read from Supabase, but the create/edit
 * form is not yet wired up (A2–A5 share that gap).
 */

const FIELDS: ResourceField[] = [
  { key: "name", label: "Name" },
  { key: "trigger", label: "When the quote contains" },
  { key: "suggests", label: "Suggest" },
  { key: "priority", label: "Priority", type: "number" },
];

type Row = {
  id: string;
  name: string;
  priority: number | null;
  trigger_category: string | null;
  trigger_product: { name: string | null } | null;
  suggested_product: { name: string | null } | null;
};

export default async function Page() {
  const role = await currentRole();
  if (!canWrite("upsellRules", role)) redirect("/unauthorized");

  const supabase = createServerSupabaseClient();

  const { data } = await supabase
    .from("upsell_rules")
    .select(
      `id, name, priority, trigger_category,
       trigger_product:products!upsell_rules_trigger_product_id_fkey(name),
       suggested_product:products!upsell_rules_suggested_product_id_fkey(name)`,
    )
    .eq("active", true)
    .order("priority", { ascending: true })
    .returns<Row[]>();

  const rows: ResourceRow[] = (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    // A rule fires on a specific product or on a whole category.
    trigger: row.trigger_product?.name ?? row.trigger_category ?? "Anything",
    suggests: row.suggested_product?.name ?? "—",
    priority: row.priority ?? 100,
  }));

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4">
      <ResourceTable title="Upsell rules" fields={FIELDS} rows={rows} />
    </main>
  );
}

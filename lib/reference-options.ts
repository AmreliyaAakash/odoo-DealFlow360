import "server-only";
import type { EntityField } from "@/lib/backend-entities";
import { createServerSupabaseClient } from "@/lib/supabase-server";

/**
 * The choices behind every `reference` field on a config screen.
 *
 * Loaded server-side and handed down, rather than fetched from the dialog when
 * it opens: the table needs the same map to turn a stored id into a name, so
 * fetching per-dialog would mean the list shows "—" until somebody clicks Edit.
 *
 * Keyed by field, not by table, because two fields on one entity can point at
 * the same table under different filters — an upsell rule's trigger and its
 * suggestion are both products, and a future rule may narrow one of them.
 */

export type ReferenceOption = { value: string; label: string };

/** field key → the rows that field may point at. */
export type ReferenceOptions = Record<string, ReferenceOption[]>;

export async function loadReferenceOptions(
  fields: EntityField[],
): Promise<ReferenceOptions> {
  const referenceFields = fields.filter(
    (field) => field.type === "reference" && field.reference,
  );
  const suggestFields = fields.filter((field) => field.suggestFrom);

  if (referenceFields.length === 0 && suggestFields.length === 0) return {};

  const supabase = createServerSupabaseClient();

  // Distinct values already in use for a free-text field. Offered rather than
  // enforced: a desk writing a rule for a category it is about to introduce is
  // legitimate, and a closed list would block it.
  const suggested = await Promise.all(
    suggestFields.map(async (field) => {
      const { table, column } = field.suggestFrom!;

      const { data } = await supabase
        .from(table)
        .select(column)
        .order(column, { ascending: true })
        .limit(1000)
        .returns<Record<string, string | null>[]>();

      const seen = new Set<string>();
      for (const row of data ?? []) {
        const value = row[column];
        if (value) seen.add(value);
      }

      return [
        field.key,
        [...seen].map((value) => ({ value, label: value })),
      ] as const;
    }),
  );

  const loaded = await Promise.all(
    referenceFields.map(async (field) => {
      const source = field.reference!;

      let query = supabase
        .from(source.table)
        .select(`id, ${source.labelColumn}`)
        .order(source.labelColumn, { ascending: true })
        .limit(500);

      // An archived row must not be offered as a new choice. Rows already
      // pointing at one still render its name, because the map below is only
      // consulted for display — an existing rule keeps working.
      if (source.activeColumn) query = query.eq(source.activeColumn, true);

      const { data } = await query.returns<Record<string, string>[]>();

      return [
        field.key,
        (data ?? []).map((row) => ({
          value: row.id,
          label: row[source.labelColumn] ?? row.id,
        })),
      ] as const;
    }),
  );

  return Object.fromEntries([...loaded, ...suggested]);
}

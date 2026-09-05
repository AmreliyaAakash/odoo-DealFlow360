/**
 * Telling "this database is behind the code" apart from "something broke".
 *
 * A database created before a migration landed answers a perfectly good query
 * with "Could not find the table 'public.subscriptions' in the schema cache" or
 * "column products.unit does not exist". Both read like faults and neither is:
 * they are a setup step outstanding, and the useful response is the name of the
 * file to run, not PostgREST's wording.
 *
 * This lived twice — once in `stock-server.ts`, once in `_entity-page.tsx` —
 * and covered only missing tables, so the two screens that hit a missing
 * *column* showed the raw string instead. One copy, both cases.
 */

/** The migration that closes every gap this app currently knows about. */
export const SCHEMA_MIGRATION = "db/migrations/002-missing-objects.sql";

export type SchemaGap = {
  kind: "table" | "column";
  /** The relation or column the database is missing, when it can be read. */
  subject: string | null;
};

type SupabaseError = { code?: string; message?: string } | null | undefined;

/**
 * The gap this error describes, or null when it is a real failure.
 *
 * Matched on the error codes first and the message only as a fallback, because
 * which of the two surfaces depends on whether the request got past PostgREST's
 * schema cache. `PGRST205`/`42P01` are the missing relation; `PGRST204`/`42703`
 * are the missing column.
 */
export function schemaGap(error: SupabaseError): SchemaGap | null {
  if (!error) return null;

  const message = error.message ?? "";

  if (
    error.code === "PGRST205" ||
    error.code === "42P01" ||
    /could not find the table|relation "[^"]+" does not exist/i.test(message)
  ) {
    const match = message.match(/'(?:public\.)?([\w.]+)'|relation "([^"]+)"/i);
    return { kind: "table", subject: match?.[1] ?? match?.[2] ?? null };
  }

  if (
    error.code === "PGRST204" ||
    error.code === "42703" ||
    /column [\w."]+ does not exist|could not find the '[^']+' column/i.test(message)
  ) {
    const match = message.match(/column ([\w."]+) does not exist|'([^']+)' column/i);
    return { kind: "column", subject: match?.[1] ?? match?.[2] ?? null };
  }

  return null;
}

/** Kept for the call sites that only care whether a table is absent. */
export function isMissingTable(error: SupabaseError): boolean {
  return schemaGap(error)?.kind === "table";
}

/** One sentence naming what is missing, for a notice. */
export function schemaGapSummary(gap: SchemaGap): string {
  if (gap.kind === "table") {
    return gap.subject
      ? `The ${gap.subject} table is not in this database yet.`
      : "A table this build expects is not in this database yet.";
  }

  return gap.subject
    ? `The ${gap.subject} column is not in this database yet.`
    : "A column this build expects is not in this database yet.";
}

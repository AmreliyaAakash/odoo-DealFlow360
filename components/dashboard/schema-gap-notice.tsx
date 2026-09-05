import { SCHEMA_MIGRATION, schemaGapSummary, type SchemaGap } from "@/lib/schema-gap";
import { Notice } from "@/components/dashboard/panel";

/**
 * What a screen shows when the database is behind the build.
 *
 * Deliberately not `tone="danger"`: nothing has failed, and a red banner sends
 * an admin looking for a bug instead of running a file. The whole value of this
 * notice is naming that file, so it says what is missing and what to run, and
 * never relays the PostgREST string that prompted it.
 */
export function SchemaGapNotice({ gap }: { gap: SchemaGap }) {
  return (
    <Notice>
      {schemaGapSummary(gap)} Run{" "}
      <code className="mx-0.5 rounded bg-muted px-1 py-0.5 text-[10px]">
        {SCHEMA_MIGRATION}
      </code>{" "}
      in the Supabase SQL editor, then reload. It adds only what is missing —
      no table is dropped and no row is deleted.
    </Notice>
  );
}

import { requireCapability } from "@/lib/auth";
import { entityConfig, type BackendEntity } from "@/lib/backend-entities";
import { loadReferenceOptions } from "@/lib/reference-options";
import { canWith, effectiveAccess } from "@/lib/permissions-server";
import { schemaGap } from "@/lib/schema-gap";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { Notice, PageHeader } from "@/components/dashboard/panel";
import {
  ResourceTable,
  type ResourceRow,
} from "@/components/backend/resource-table";
import { SchemaGapNotice } from "@/components/dashboard/schema-gap-notice";

/**
 * Shared body for the config screens (A2–A5). They differ only by entity, so
 * the page files are thin wrappers around this.
 */
export async function EntityPage({ entity }: { entity: BackendEntity }) {
  const config = entityConfig(entity);

  const authorized = await requireCapability(config.module, "view");
  if (!authorized.ok) {
    return (
      <main className="flex min-w-0 flex-1 flex-col gap-4">
        <PageHeader
          title={config.title}
          caption="Not available for your role"
        />
        <Notice tone="danger">
          You do not have access to this configuration.
        </Notice>
      </main>
    );
  }

  const { userId, role } = authorized.actor;
  const { access } = await effectiveAccess(userId, role);
  const canWrite = canWith(access, config.module, "write");

  const supabase = createServerSupabaseClient();

  // Rows and the lookups its reference fields need, together: a table showing
  // raw uuids while the names load would be unreadable, and both are cheap.
  const [{ data, error }, references] = await Promise.all([
    supabase
      .from(config.table)
      .select(config.columns.join(", "))
      .order(config.orderBy, { ascending: true })
      .returns<ResourceRow[]>(),
    loadReferenceOptions(config.fields),
  ]);

  const rows = data ?? [];

  // A table this build knows about but the database has not got yet is a setup
  // step outstanding, not a fault. Saying which file to run is worth more than
  // relaying PostgREST's "schema cache" wording, which reads like a bug.
  const gap = schemaGap(error);

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4">
      <PageHeader
        title={config.title}
        caption={
          canWrite
            ? "Add, edit or deactivate — every change is logged"
            : "Read-only for your role"
        }
        badge={`${rows.length}`}
      />

      {gap ? (
        <SchemaGapNotice gap={gap} />
      ) : error ? (
        <Notice>
          Could not load {config.title}: {error.message}
        </Notice>
      ) : null}

      {gap ? null : (
        <ResourceTable
          entity={entity}
          title={config.title}
          fields={config.fields}
          rows={rows}
          canWrite={canWrite}
          references={references}
        />
      )}
    </main>
  );
}


import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";
import {
  BACKEND_ENTITIES,
  entityConfig,
  isBackendEntity,
  parseRow,
  type BackendEntity,
} from "@/lib/backend-entities";
import { createServerSupabaseClient } from "@/lib/supabase-server";

/**
 * CRUD for the four admin config tables.
 *
 * One handler rather than four, because the tables differ only in their column
 * list — which lives in `lib/backend-entities.ts` and is shared with the pages
 * that render them, so a field can never be editable in the UI and rejected
 * here.
 *
 * Every write is checked against the permission matrix for that entity's module,
 * and every write is recorded in `config_audit_log`.
 */

type Ctx = RouteContext<"/api/backend/[entity]">;

async function resolve(ctx: Ctx): Promise<BackendEntity | null> {
  const { entity } = await ctx.params;
  return isBackendEntity(entity) ? entity : null;
}

function badEntity() {
  return NextResponse.json(
    { error: `entity must be one of: ${BACKEND_ENTITIES.join(", ")}` },
    { status: 404 },
  );
}

export async function GET(_request: Request, ctx: Ctx) {
  const entity = await resolve(ctx);
  if (!entity) return badEntity();

  const config = entityConfig(entity);
  const authorized = await requireCapability(config.module, "view");
  if (!authorized.ok) return authorized.response;

  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from(config.table)
    .select(config.columns.join(", "))
    .order(config.orderBy, { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ rows: data ?? [] });
}

export async function POST(request: Request, ctx: Ctx) {
  const entity = await resolve(ctx);
  if (!entity) return badEntity();

  const config = entityConfig(entity);
  const authorized = await requireCapability(config.module, "write");
  if (!authorized.ok) return authorized.response;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = parseRow(entity, payload, { partial: false });
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from(config.table)
    .insert(parsed.values)
    .select(config.columns.join(", "))
    .single<Record<string, unknown>>();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await record(supabase, authorized.actor.userId, entity, data, "create", null, null, null);

  return NextResponse.json({ row: data }, { status: 201 });
}

export async function PATCH(request: Request, ctx: Ctx) {
  const entity = await resolve(ctx);
  if (!entity) return badEntity();

  const config = entityConfig(entity);
  const authorized = await requireCapability(config.module, "write");
  if (!authorized.ok) return authorized.response;

  let payload: { id?: unknown } & Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { id } = payload;
  if (typeof id !== "string" || !id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const parsed = parseRow(entity, payload, { partial: true });
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  if (Object.keys(parsed.values).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const supabase = createServerSupabaseClient();

  // Read first, so the audit trail can name what actually changed.
  const { data: before } = await supabase
    .from(config.table)
    .select(config.columns.join(", "))
    .eq("id", id)
    .maybeSingle<Record<string, unknown>>();

  if (!before) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from(config.table)
    .update(parsed.values)
    .eq("id", id)
    .select(config.columns.join(", "))
    .single<Record<string, unknown>>();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  for (const [field, next] of Object.entries(parsed.values)) {
    const previous = before[field];
    if (String(previous ?? "") === String(next ?? "")) continue;

    await record(
      supabase,
      authorized.actor.userId,
      entity,
      data,
      "update",
      field,
      previous,
      next,
    );
  }

  return NextResponse.json({ row: data });
}

export async function DELETE(request: Request, ctx: Ctx) {
  const entity = await resolve(ctx);
  if (!entity) return badEntity();

  const config = entityConfig(entity);
  const authorized = await requireCapability(config.module, "write");
  if (!authorized.ok) return authorized.response;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const supabase = createServerSupabaseClient();

  const { data: before } = await supabase
    .from(config.table)
    .select(config.columns.join(", "))
    .eq("id", id)
    .maybeSingle<Record<string, unknown>>();

  // Config rows are referenced by quotations, so deactivate rather than delete
  // where the table supports it — a hard delete would orphan historic lines.
  const { error } = config.softDelete
    ? await supabase.from(config.table).update({ active: false }).eq("id", id)
    : await supabase.from(config.table).delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await record(supabase, authorized.actor.userId, entity, before, "delete", null, null, null);

  return NextResponse.json({ id, softDeleted: config.softDelete });
}

/** Appends one line to the change trail the admin dashboard reads. */
async function record(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  actorId: string,
  entity: BackendEntity,
  row: Record<string, unknown> | null,
  action: "create" | "update" | "delete",
  field: string | null,
  oldValue: unknown,
  newValue: unknown,
) {
  const config = entityConfig(entity);

  // The trail is a record, not a gate: a failure here must not undo the write.
  await supabase.from("config_audit_log").insert({
    actor_id: actorId,
    entity: config.table,
    entity_id: row?.id ? String(row.id) : null,
    entity_label: row?.[config.labelColumn] ? String(row[config.labelColumn]) : null,
    action,
    field,
    old_value: oldValue === null || oldValue === undefined ? null : String(oldValue),
    new_value: newValue === null || newValue === undefined ? null : String(newValue),
  });
}

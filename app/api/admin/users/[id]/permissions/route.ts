import { clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { currentUser, requireRole } from "@/lib/auth";
import { CAPABILITIES, MODULES, type Capability, type Module } from "@/lib/permissions";
import { effectiveAccess, roleBaseline } from "@/lib/permissions-server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import type { Role } from "@/types/globals";

/**
 * One account's per-module exceptions.
 *
 * GET  — what the role grants, what has been changed for this account, and the
 *        resulting effective set, which is what the editor renders.
 * PUT  — replace the exceptions wholesale.
 *
 * Never applies to an admin. An admin holds everything by definition, and
 * allowing a per-account narrowing would let one admin quietly strip another —
 * or themselves — of the screen that puts it back.
 */

const SCOPES = ["none", "own", "team", "all"] as const;
type Scope = (typeof SCOPES)[number];

export type OverrideInput = {
  module: Module;
  capability: Capability;
  scope: Scope;
};

function isModule(value: unknown): value is Module {
  return typeof value === "string" && (MODULES as readonly string[]).includes(value);
}

function isCapability(value: unknown): value is Capability {
  return (
    typeof value === "string" && (CAPABILITIES as readonly string[]).includes(value)
  );
}

function isScope(value: unknown): value is Scope {
  return typeof value === "string" && (SCOPES as readonly string[]).includes(value);
}

async function targetRole(id: string): Promise<Role | null> {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(id);
    const role = user.publicMetadata?.role;
    return typeof role === "string" ? (role as Role) : null;
  } catch {
    return null;
  }
}

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/admin/users/[id]/permissions">,
) {
  const authorized = await requireRole(["admin"]);
  if (!authorized.ok) return authorized.response;

  const { id } = await ctx.params;
  const role = await targetRole(id);
  if (!role) {
    return NextResponse.json({ error: "User has no role assigned" }, { status: 404 });
  }

  const supabase = createServerSupabaseClient();

  const [baseline, resolved, overrides] = await Promise.all([
    roleBaseline(role),
    effectiveAccess(id, role),
    supabase
      .from("user_module_permissions")
      .select("module, capability, scope")
      .eq("user_id", id)
      .returns<{ module: string; capability: string; scope: string }[]>(),
  ]);

  return NextResponse.json({
    role,
    // An admin's set is not editable, so the UI can render it read-only.
    editable: role !== "admin",
    baseline,
    effective: resolved.access,
    customized: resolved.customized,
    overrides: overrides.data ?? [],
  });
}

export async function PUT(
  request: Request,
  ctx: RouteContext<"/api/admin/users/[id]/permissions">,
) {
  const authorized = await requireRole(["admin"]);
  if (!authorized.ok) return authorized.response;

  const { id } = await ctx.params;
  const { userId: actingUserId } = await currentUser();

  const role = await targetRole(id);
  if (!role) {
    return NextResponse.json({ error: "User has no role assigned" }, { status: 404 });
  }
  if (role === "admin") {
    return NextResponse.json(
      { error: "An admin's access cannot be changed per account, only role-wide" },
      { status: 409 },
    );
  }

  let payload: { overrides?: unknown; customized?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(payload.overrides)) {
    return NextResponse.json(
      { error: "overrides must be an array of { module, capability, scope }" },
      { status: 400 },
    );
  }

  const overrides: OverrideInput[] = [];
  const seen = new Set<string>();

  for (const raw of payload.overrides) {
    if (typeof raw !== "object" || raw === null) {
      return NextResponse.json({ error: "Each override must be an object" }, { status: 400 });
    }
    const { module, capability, scope } = raw as Record<string, unknown>;

    if (!isModule(module)) {
      return NextResponse.json({ error: `Unknown module: ${String(module)}` }, { status: 400 });
    }
    if (!isCapability(capability)) {
      return NextResponse.json(
        { error: `Unknown capability for ${module}: ${String(capability)}` },
        { status: 400 },
      );
    }
    if (!isScope(scope)) {
      return NextResponse.json(
        { error: `Unknown scope for ${module}: ${String(scope)}` },
        { status: 400 },
      );
    }
    // A module named twice would make the saved result depend on row order.
    if (seen.has(module)) {
      return NextResponse.json({ error: `${module} listed twice` }, { status: 400 });
    }

    seen.add(module);
    overrides.push({ module, capability, scope });
  }

  const customized = payload.customized === true;
  const supabase = createServerSupabaseClient();

  // Replace wholesale: whatever is not in the payload is no longer an exception.
  const { error: clearError } = await supabase
    .from("user_module_permissions")
    .delete()
    .eq("user_id", id);

  if (clearError) {
    return NextResponse.json({ error: clearError.message }, { status: 500 });
  }

  if (overrides.length > 0) {
    const { error: insertError } = await supabase.from("user_module_permissions").insert(
      overrides.map((override) => ({
        user_id: id,
        module: override.module,
        capability: override.capability,
        scope: override.scope,
        created_by: actingUserId,
      })),
    );

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }
  }

  const { error: profileError } = await supabase
    .from("user_permission_profiles")
    .upsert(
      {
        user_id: id,
        customized,
        updated_at: new Date().toISOString(),
        updated_by: actingUserId,
      },
      { onConflict: "user_id" },
    );

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  await supabase.from("config_audit_log").insert({
    actor_id: actingUserId,
    actor_name: "Admin",
    entity: "users",
    entity_id: id,
    entity_label: `Permissions (${role})`,
    action: "update",
    field: "module access",
    old_value: null,
    new_value: overrides.length === 0
      ? "reset to role defaults"
      : overrides.map((o) => `${o.module}=${o.capability}`).join(", "),
  });

  const resolved = await effectiveAccess(id, role);

  return NextResponse.json({
    role,
    effective: resolved.access,
    customized: resolved.customized,
    overrides,
  });
}

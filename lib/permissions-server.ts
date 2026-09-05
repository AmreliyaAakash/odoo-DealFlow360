import "server-only";
import {
  MODULES,
  PERMISSIONS,
  accessFor,
  type Access,
  type Capability,
  type Module,
  type Scope,
} from "@/lib/permissions";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import type { Role } from "@/types/globals";

/**
 * Resolving what one account may actually do.
 *
 * Three layers, outermost last — the same order the SQL functions in
 * db/schema.sql apply, because both have to agree:
 *
 *   1. the static matrix in lib/permissions.ts (the fallback);
 *   2. `role_module_permissions`, the role's defaults as editable data;
 *   3. `user_module_permissions`, this one account's exception.
 *
 * An admin is exempt from layer 3 in both directions: their access cannot be
 * narrowed or widened per account, only role-wide. Without that guard an admin
 * could revoke their own access to the screen that hands it back.
 */

export type ModuleAccess = Record<Module, Access>;

export type EffectiveAccess = {
  role: Role | null;
  access: ModuleAccess;
  /**
   * True when this account's permissions are a standalone snapshot: editing the
   * role no longer reaches it, only its own checklist does.
   */
  customized: boolean;
};

type PermissionRow = {
  module: string;
  capability: string;
  scope: string;
};

const CAPABILITIES = new Set<string>(["none", "view", "use", "write", "full"]);
const SCOPES = new Set<string>(["none", "own", "team", "all"]);

function asAccess(row: PermissionRow): Access | null {
  if (!CAPABILITIES.has(row.capability) || !SCOPES.has(row.scope)) return null;
  return { capability: row.capability as Capability, scope: row.scope as Scope };
}

/** Every module at `none`. The starting point for a customized account. */
function emptyAccess(): ModuleAccess {
  return Object.fromEntries(
    MODULES.map((module) => [module, { capability: "none", scope: "none" }]),
  ) as ModuleAccess;
}

/** The static matrix for one role — layer 1. */
export function staticAccess(role: Role | null): ModuleAccess {
  return Object.fromEntries(
    MODULES.map((module) => [module, accessFor(module, role)]),
  ) as ModuleAccess;
}

function fullAccess(): ModuleAccess {
  return Object.fromEntries(
    MODULES.map((module) => [module, { capability: "full", scope: "all" }]),
  ) as ModuleAccess;
}

/**
 * What `userId` may do, after every layer.
 *
 * A failed lookup falls back to the static matrix rather than to nothing: a
 * database blip should not silently strip a user of the access their role
 * plainly grants, and the API and RLS both re-check anyway.
 */
export async function effectiveAccess(
  userId: string | null,
  role: Role | null,
): Promise<EffectiveAccess> {
  // Admins hold everything and take no overrides.
  if (role === "admin") {
    return { role, access: fullAccess(), customized: false };
  }

  if (!userId || !role) {
    return { role, access: staticAccess(role), customized: false };
  }

  const supabase = createServerSupabaseClient();

  const [roleRows, userRows, profile] = await Promise.all([
    supabase
      .from("role_module_permissions")
      .select("module, capability, scope")
      .eq("role", role)
      .returns<PermissionRow[]>(),
    supabase
      .from("user_module_permissions")
      .select("module, capability, scope")
      .eq("user_id", userId)
      .returns<PermissionRow[]>(),
    supabase
      .from("user_permission_profiles")
      .select("customized")
      .eq("user_id", userId)
      .maybeSingle<{ customized: boolean }>(),
  ]);

  if (roleRows.error || userRows.error) {
    return { role, access: staticAccess(role), customized: false };
  }

  const customized = profile.data?.customized ?? false;

  // A customized account IS its overrides — the role is not consulted at all,
  // so a later edit to that role never reaches this account again.
  const base = customized ? emptyAccess() : roleDefaults(role, roleRows.data ?? []);

  for (const row of userRows.data ?? []) {
    if (!isModule(row.module)) continue;
    const access = asAccess(row);
    if (access) base[row.module] = access;
  }

  return { role, access: base, customized };
}

/**
 * Layer 2 over layer 1: rows from the database win, and any module the database
 * has not got a row for keeps its value from the static matrix. That is what
 * makes an un-seeded install behave exactly like a seeded one.
 */
function roleDefaults(role: Role, rows: PermissionRow[]): ModuleAccess {
  const access = staticAccess(role);

  for (const row of rows) {
    if (!isModule(row.module)) continue;
    const parsed = asAccess(row);
    if (parsed) access[row.module] = parsed;
  }

  return access;
}

function isModule(value: string): value is Module {
  return (MODULES as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------ *
 * Reading a resolved set
 * ------------------------------------------------------------------ */

const RANK: Record<Capability, number> = {
  none: 0,
  view: 1,
  use: 2,
  write: 3,
  full: 4,
};

export function canWith(
  access: ModuleAccess,
  module: Module,
  minimum: Capability = "view",
): boolean {
  return RANK[access[module].capability] >= RANK[minimum];
}

export function scopeWith(access: ModuleAccess, module: Module): Scope {
  return access[module].scope;
}

/**
 * The matrix a role would have with no overrides at all, for the admin editor:
 * it shows what the account inherits next to what has been changed for it.
 */
export async function roleBaseline(role: Role): Promise<ModuleAccess> {
  if (role === "admin") return fullAccess();

  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("role_module_permissions")
    .select("module, capability, scope")
    .eq("role", role)
    .returns<PermissionRow[]>();

  if (error) return staticAccess(role);
  return roleDefaults(role, data ?? []);
}

/** Modules in matrix order, for rendering an editor that never reshuffles. */
export const MODULE_ORDER = MODULES;

export { PERMISSIONS };

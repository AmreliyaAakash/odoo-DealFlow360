"use client";

import { useUser } from "@clerk/nextjs";
import {
  accessFor,
  can,
  scopeFor,
  type Access,
  type Capability,
  type Module,
  type Scope,
} from "@/lib/permissions";
import type { Role } from "@/types/globals";

/**
 * The signed-in user's role, in the browser.
 *
 * This lives apart from `lib/auth.ts` on purpose: that module imports
 * `@clerk/nextjs/server`, and importing it from a client component would pull
 * server-only code into the browser bundle and fail the build. Both read the
 * same `publicMetadata.role`, and both defer to the same matrix.
 *
 * Hiding a control is a courtesy, not a defence. Every action a role may not
 * take is refused again by the API — see `requireRole` / `requireCapability`.
 */

const ROLES = new Set<string>(["admin", "manager", "finance", "rep", "customer"]);

function asRole(value: unknown): Role | null {
  return typeof value === "string" && ROLES.has(value) ? (value as Role) : null;
}

export type UseRole = {
  role: Role | null;
  /** False until Clerk has hydrated; render neither the control nor its absence. */
  loaded: boolean;
  can: (module: Module, minimum?: Capability) => boolean;
  canView: (module: Module) => boolean;
  canWrite: (module: Module) => boolean;
  access: (module: Module) => Access;
  scope: (module: Module) => Scope;
};

export function useRole(): UseRole {
  const { user, isLoaded } = useUser();
  const role = asRole(user?.publicMetadata?.role);

  return {
    role,
    loaded: isLoaded,
    can: (module, minimum = "view") => can(module, role, minimum),
    canView: (module) => can(module, role, "view"),
    canWrite: (module) => can(module, role, "write"),
    access: (module) => accessFor(module, role),
    scope: (module) => scopeFor(module, role),
  };
}

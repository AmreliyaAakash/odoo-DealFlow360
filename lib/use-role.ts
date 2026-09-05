"use client";

import { useUser } from "@clerk/nextjs";
import { useResolvedPermissions } from "@/app/(dashboard)/permissions-provider";
import {
  accessFor,
  can,
  scopeFor,
  type Access,
  type Capability,
  type Module,
  type Scope,
} from "@/lib/permissions";
import { asRole } from "@/lib/roles";
import type { Role } from "@/types/globals";

/**
 * What the signed-in user may do, in the browser.
 *
 * Prefers the access the server resolved for this request — which includes any
 * per-account override — and falls back to the static matrix for the Clerk role
 * when rendered outside the provider. The fallback is never *more* permissive
 * than the resolved answer for a plain account; it only misses overrides.
 *
 * This lives apart from `lib/auth.ts` because that module imports
 * `@clerk/nextjs/server`, and importing it from a client component would pull
 * server-only code into the browser bundle and fail the build.
 *
 * Hiding a control is a courtesy, not a defence. Every action a role may not
 * take is refused again by the API and by RLS.
 */

const RANK: Record<Capability, number> = {
  none: 0,
  view: 1,
  use: 2,
  write: 3,
  full: 4,
};

export type UseRole = {
  role: Role | null;
  /** False until Clerk has hydrated; render neither the control nor its absence. */
  loaded: boolean;
  /** True when this account's access is a snapshot independent of its role. */
  customized: boolean;
  can: (module: Module, minimum?: Capability) => boolean;
  canView: (module: Module) => boolean;
  canWrite: (module: Module) => boolean;
  access: (module: Module) => Access;
  scope: (module: Module) => Scope;
};

export function useRole(): UseRole {
  const { user, isLoaded } = useUser();
  const resolved = useResolvedPermissions();

  const role = resolved?.role ?? asRole(user?.publicMetadata?.role);

  const access = (module: Module): Access =>
    resolved?.access[module] ?? accessFor(module, role);

  return {
    role,
    // The server-resolved set does not wait on Clerk to hydrate.
    loaded: resolved !== null || isLoaded,
    customized: resolved?.customized ?? false,
    can: (module, minimum = "view") =>
      resolved
        ? RANK[access(module).capability] >= RANK[minimum]
        : can(module, role, minimum),
    canView: (module) =>
      resolved ? RANK[access(module).capability] >= RANK.view : can(module, role, "view"),
    canWrite: (module) =>
      resolved
        ? RANK[access(module).capability] >= RANK.write
        : can(module, role, "write"),
    access,
    scope: (module) => resolved?.access[module].scope ?? scopeFor(module, role),
  };
}

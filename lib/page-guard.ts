import "server-only";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import type { Capability, Module } from "@/lib/permissions";
import { canWith, effectiveAccess, scopeWith } from "@/lib/permissions-server";
import type { Role } from "@/types/globals";

/**
 * The guard every entity screen starts with.
 *
 * `proxy.ts` decides who may load a URL at all; this decides what the account
 * may do once it is there, from the same matrix the API and RLS read. Both are
 * needed: the route guard works on roles, and a per-account override can grant
 * or revoke a module without changing anyone's role.
 *
 * Returns what the caller may do rather than a bare boolean, so a page can hand
 * the same answer to its components instead of resolving access twice.
 */
export type PageActor = {
  userId: string;
  role: Role | null;
  scope: ReturnType<typeof scopeWith>;
  canWrite: boolean;
  /** Resolved access for any other module the page needs to check. */
  can: (module: Module, minimum?: Capability) => boolean;
};

export async function requireModule(
  module: Module,
  minimum: Capability = "view",
): Promise<PageActor> {
  const { userId, role } = await currentUser();
  if (!userId) redirect("/sign-in");

  const { access } = await effectiveAccess(userId, role);
  if (!canWith(access, module, minimum)) redirect("/unauthorized");

  return {
    userId,
    role,
    scope: scopeWith(access, module),
    canWrite: canWith(access, module, "write"),
    can: (other, level = "view") => canWith(access, other, level),
  };
}

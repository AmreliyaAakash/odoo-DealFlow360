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

/**
 * The guard for a screen assembled from several modules.
 *
 * The desk dashboards are not one entity — the approver's desk is the approval
 * queue next to the deal-health anomalies, the finance desk is billing next to
 * warehouse stock. Guarding such a page on a single module would either lock
 * out somebody who holds the other one, or let somebody in who holds neither.
 *
 * Holding any one of them opens the page; each section then checks its own
 * module through `can`, so a finance account with `warehouses` revoked gets the
 * billing half and no empty space where the stock panel was.
 *
 * `scope` and `canWrite` are answered for the first module the account actually
 * holds, so they mean something — a page needing them for a specific module
 * should ask `can` instead.
 */
export async function requireAnyModule(
  modules: Module[],
  minimum: Capability = "view",
): Promise<PageActor> {
  const { userId, role } = await currentUser();
  if (!userId) redirect("/sign-in");

  const { access } = await effectiveAccess(userId, role);

  const held = modules.find((module) => canWith(access, module, minimum));
  if (!held) redirect("/unauthorized");

  return {
    userId,
    role,
    scope: scopeWith(access, held),
    canWrite: canWith(access, held, "write"),
    can: (other, level = "view") => canWith(access, other, level),
  };
}

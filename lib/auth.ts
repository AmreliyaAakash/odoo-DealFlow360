import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { canActAtLevel, type Capability, type Module, type Scope } from "@/lib/permissions";
import { asRole } from "@/lib/roles";
import { canWith, effectiveAccess, scopeWith } from "@/lib/permissions-server";
import type { Role } from "@/types/globals";

/**
 * Server-side role helpers. Client components use `useRole()` from
 * `lib/use-role.ts` instead — this module imports `@clerk/nextjs/server`, which
 * cannot be pulled into a browser bundle.
 *
 * The role lives on the Clerk user as `publicMetadata.role`. It reaches the app
 * two ways:
 *   1. As a `publicMetadata` claim on the session token — fast, no network call,
 *      but only present once Clerk → Sessions → Customize session token includes
 *      `{ "publicMetadata": "{{user.public_metadata}}" }`.
 *   2. Read straight off the user record — always correct, one API call.
 *
 * We prefer the claim and fall back to the lookup, so the app is right either
 * way. Supabase RLS has no such fallback: `clerk_role()` reads the claim only,
 * so the session-token customisation is still required for the config tables.
 */

export const APPROVER_ROLES = ["manager", "finance", "admin"] as const;
export type ApproverRole = (typeof APPROVER_ROLES)[number];

/** Reads the role from the user record. Use only when the claim is absent. */
export async function fetchRole(userId: string): Promise<Role | null> {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    return asRole(user.publicMetadata?.role);
  } catch {
    return null;
  }
}

/** The signed-in user's Clerk ID and role. */
export async function currentUser(): Promise<{
  userId: string | null;
  role: Role | null;
}> {
  const { userId, sessionClaims } = await auth();
  if (!userId) return { userId: null, role: null };

  const claimed = asRole(sessionClaims?.publicMetadata?.role);
  return { userId, role: claimed ?? (await fetchRole(userId)) };
}

/** The signed-in user's role, or `null` when signed out or unset. */
export async function currentRole(): Promise<Role | null> {
  return (await currentUser()).role;
}

/**
 * Where a user lands after signing in.
 *
 * Every staff role now opens on the shared dashboard rather than its own desk.
 * The desk screens still exist and are one tab away; what changed is that
 * "where am I when I sign in" no longer depends on my title, so a rep and a
 * manager describing the same screen to each other are describing the same
 * screen. A customer has no dashboard, so they still land in the portal.
 */
export const LANDING_BY_ROLE: Record<Role, string> = {
  admin: "/dashboard",
  manager: "/dashboard",
  finance: "/dashboard",
  rep: "/dashboard",
  specialist: "/dashboard",
  customer: "/portal",
};

/** A signed-in user with no role yet still gets the dashboard, narrowed to their own deals. */
export function landingPathForRole(role: Role | null): string {
  return role ? LANDING_BY_ROLE[role] : "/dashboard";
}

export function isApprover(role: Role | null): role is ApproverRole {
  return role !== null && (APPROVER_ROLES as readonly string[]).includes(role);
}

export function isAdmin(role: Role | null): boolean {
  return role === "admin";
}

/** True when `role` may act on an approval at `level`. Admins may act on any. */
export function canApproveLevel(role: Role | null, level: string): boolean {
  return canActAtLevel(role, level);
}

/* ------------------------------------------------------------------ *
 * API guards
 * ------------------------------------------------------------------ */

export type AuthorizedActor = {
  userId: string;
  role: Role;
  /** Which rows this actor may touch for the module that was checked. */
  scope: Scope;
};

/**
 * A refusal, ready to return from a route handler. Route code distinguishes it
 * from success by the presence of `response`, so a guard can never be ignored by
 * accident — there is no truthy actor to destructure on the failure path.
 */
export type AuthorizationFailure = { ok: false; response: NextResponse };
export type AuthorizationSuccess = { ok: true; actor: AuthorizedActor };
export type AuthorizationResult = AuthorizationSuccess | AuthorizationFailure;

function deny(status: 401 | 403, error: string): AuthorizationFailure {
  return { ok: false, response: NextResponse.json({ error }, { status }) };
}

/**
 * Authorizes one API action against an explicit list of roles.
 *
 * Called per action rather than per file: a route a role may reach is not a
 * route it may write through, so GET and POST in the same handler pass different
 * lists. Returns 401 when signed out and 403 when signed in as the wrong role,
 * because the two need different client behaviour.
 */
export async function requireRole(
  allowed: readonly Role[],
): Promise<AuthorizationResult> {
  const { userId, role } = await currentUser();

  if (!userId) return deny(401, "Unauthorized");
  if (!role) return deny(403, "Your account has no role assigned");
  if (!allowed.includes(role)) {
    return deny(403, `A ${role} may not perform this action`);
  }

  return { ok: true, actor: { userId, role, scope: "all" } };
}

/**
 * Authorizes an action against the permission matrix rather than a hand-written
 * role list, and reports back the row scope the caller must apply.
 *
 * Prefer this over `requireRole` wherever the action maps onto a module: the
 * matrix stays the one place the rules live, and the returned `scope` is the
 * reminder that "manager" and "rep" may both pass while seeing different rows.
 */
export async function requireCapability(
  module: Module,
  minimum: Capability = "view",
): Promise<AuthorizationResult> {
  const { userId, role } = await currentUser();

  if (!userId) return deny(401, "Unauthorized");
  if (!role) return deny(403, "Your account has no role assigned");

  // Resolved, not static: an account granted a module its role does not have
  // passes here, and one that has had a module taken away does not.
  const { access } = await effectiveAccess(userId, role);

  if (!canWith(access, module, minimum)) {
    return deny(
      403,
      `A ${role} has ${access[module].capability} access here and needs ${minimum}`,
    );
  }

  return { ok: true, actor: { userId, role, scope: scopeWith(access, module) } };
}

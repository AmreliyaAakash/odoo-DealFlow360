import { auth, clerkClient } from "@clerk/nextjs/server";
import type { Role } from "@/types/globals";

/**
 * Role helpers.
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

const ROLES = new Set<string>(["admin", "manager", "finance", "rep"]);

function asRole(value: unknown): Role | null {
  return typeof value === "string" && ROLES.has(value) ? (value as Role) : null;
}

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
 * Where a user lands after signing in. Each role goes straight to the screen it
 * spends its day on; `/` redirects here.
 */
export const LANDING_BY_ROLE: Record<Role, string> = {
  admin: "/backend/products",
  manager: "/manager",
  finance: "/finance",
  rep: "/rep",
};

/** Reps have no role set until an admin assigns one, so default to the rep desk. */
export function landingPathForRole(role: Role | null): string {
  return role ? LANDING_BY_ROLE[role] : "/rep";
}

export function isApprover(role: Role | null): role is ApproverRole {
  return role !== null && (APPROVER_ROLES as readonly string[]).includes(role);
}

export function isAdmin(role: Role | null): boolean {
  return role === "admin";
}

/** True when `role` may act on an approval at `level`. Admins may act on any. */
export function canApproveLevel(role: Role | null, level: string): boolean {
  if (!isApprover(role)) return false;
  return role === "admin" || role === level;
}

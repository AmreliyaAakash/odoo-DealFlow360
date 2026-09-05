import { redirect } from "next/navigation";
import { currentUser, isAdmin } from "@/lib/auth";
import type { Role } from "@/types/globals";

/**
 * Every /admin page is admin-only. `proxy.ts` already gates the path, but a
 * middleware matcher is easy to widen by accident; this makes the requirement
 * local to the pages that depend on it.
 */
export async function requireAdmin(): Promise<Role> {
  const { userId, role } = await currentUser();
  if (!userId) redirect("/sign-in");
  if (!isAdmin(role)) redirect("/");
  return role!;
}

import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import type { Role } from "@/types/globals";

const ALLOWED = new Set<Role>(["finance", "admin"]);

/**
 * Every /finance page is finance-or-admin only. `proxy.ts` gates the path to
 * approver roles; this narrows it further so a sales manager cannot read the
 * billing queue.
 */
export async function requireFinance(): Promise<Role> {
  const { userId, role } = await currentUser();
  if (!userId) redirect("/sign-in");
  if (!role || !ALLOWED.has(role)) redirect("/");
  return role;
}

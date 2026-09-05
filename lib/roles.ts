import type { Role } from "@/types/globals";

/**
 * Everything about a role that both the server and the browser need.
 *
 * No server-only imports here on purpose: `lib/auth.ts` pulls in
 * `@clerk/nextjs/server` and cannot be touched from a client component, so the
 * pieces both sides share — the guard, the labels, the accent classes — live
 * here instead of being written out twice and drifting.
 */

export const ROLES = [
  "admin",
  "manager",
  "finance",
  "rep",
  "specialist",
  "customer",
] as const;

const ROLE_SET = new Set<string>(ROLES);

/** Narrows an unknown claim to a Role, or null. The only place this is decided. */
export function asRole(value: unknown): Role | null {
  return typeof value === "string" && ROLE_SET.has(value) ? (value as Role) : null;
}

/** Human names. Keyed loosely so `"none"` and an unknown value both work. */
export const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  manager: "Sales Manager",
  finance: "Finance",
  rep: "Sales Rep",
  specialist: "Specialist",
  customer: "Customer (portal)",
  none: "No role",
};

/**
 * One accent per role, matching the workspace each of them lands in: rep indigo,
 * approver amber, finance emerald, admin violet, portal sky. Whole class strings
 * so Tailwind's scanner can see them.
 */
export const ROLE_STYLES: Record<string, string> = {
  admin: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  manager: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  finance: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  rep: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  // Slate, not a department colour: a specialist has whatever access the admin
  // gave them, so a badge borrowed from finance or sales would misdescribe it.
  specialist: "bg-slate-500/10 text-slate-600 dark:text-slate-300",
  customer: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  none: "bg-muted text-muted-foreground",
};

export function roleLabel(role: string | null): string {
  return ROLE_LABELS[role ?? "none"] ?? role ?? "No role";
}

export function roleStyle(role: string | null): string {
  return ROLE_STYLES[role ?? "none"] ?? ROLE_STYLES.none;
}

/**
 * A Clerk id shortened for display, e.g. `user_3Itk…`.
 *
 * Only ever a fallback: it appears when a name lookup failed, and a truncated id
 * is more use to whoever is debugging than a blank cell.
 */
export function shortId(id: string, max = 12): string {
  return id.length > max ? `${id.slice(0, max - 2)}…` : id;
}

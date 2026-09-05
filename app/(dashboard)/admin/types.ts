/** View models for the admin dashboard. */

export type AdminStats = {
  /** Clerk users who have been active inside the activity window. */
  activeUsers: number;
  /** Every user on the instance, active or not. */
  totalUsers: number;
  discountRules: number;
  warehouses: number;
  products: number;
  subscriptionPlans: number;
};

/** How recently a user must have been seen to count as active. */
export const ACTIVE_WITHIN_DAYS = 30;

export type DealVolumePoint = {
  /** ISO date of the week start, for stable keys. */
  date: string;
  /** Short axis label, e.g. "12 Aug". */
  label: string;
  /** Net value of quotations raised that week. */
  value: number;
  /** How many quotations that was. */
  count: number;
};

/** Weeks of history on the deal-volume chart. */
export const VOLUME_WEEKS = 12;

/**
 * Audit rows keep their database column names. Realtime hands us the raw row on
 * insert, so matching the table shape means new entries need no translation
 * before they render.
 */
export type AuditLogRow = {
  id: string;
  actor_id: string;
  actor_name: string | null;
  entity: string;
  entity_id: string | null;
  entity_label: string | null;
  action: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
};

/** Human labels for the `entity` column, which stores table names. */
export const ENTITY_LABELS: Record<string, string> = {
  products: "Products",
  discount_rules: "Discount Rules",
  warehouses: "Warehouses",
  subscription_plans: "Subscription Plans",
  users: "Users & Roles",
};

export const ACTION_STYLES: Record<string, string> = {
  create: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  update: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  delete: "bg-red-500/10 text-red-600 dark:text-red-400",
};

export const EMPTY_ADMIN_STATS: AdminStats = {
  activeUsers: 0,
  totalUsers: 0,
  discountRules: 0,
  warehouses: 0,
  products: 0,
  subscriptionPlans: 0,
};

/** One person on the Users & Roles screen. */
export type ManagedUser = {
  id: string;
  name: string;
  email: string | null;
  role: string | null;
  lastActiveAt: string | null;
  createdAt: string;
  /** True when this account has module access of its own, apart from its role. */
  customized: boolean;
};

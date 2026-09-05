import { clerkClient } from "@clerk/nextjs/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import {
  ACTIVE_WITHIN_DAYS,
  EMPTY_ADMIN_STATS,
  VOLUME_WEEKS,
  type AdminStats,
  type AuditLogRow,
  type DealVolumePoint,
  type ManagedUser,
} from "./types";

/** Audit entries seeded into the table before realtime takes over. */
const AUDIT_PAGE_SIZE = 12;

/** Clerk pages at 500; more users than this is beyond what this screen shows. */
const USER_PAGE_SIZE = 500;

type QuotationRow = {
  net_total: number | null;
  created_at: string | null;
};

export type AdminDashboardData = {
  stats: AdminStats;
  volume: DealVolumePoint[];
  audit: AuditLogRow[];
  loadError: string | null;
};

/**
 * Everything the admin dashboard renders. Config counts come back as `count`
 * queries rather than row fetches — the dashboard only needs the totals, and the
 * catalog can be large.
 */
export async function loadAdminDashboard(): Promise<AdminDashboardData> {
  const supabase = createServerSupabaseClient();

  const [products, rules, warehouses, plans, quotations, audit, users] = await Promise.all([
    supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("active", true),
    supabase
      .from("discount_rules")
      .select("id", { count: "exact", head: true })
      .eq("active", true),
    supabase
      .from("warehouses")
      .select("id", { count: "exact", head: true })
      .eq("active", true),
    supabase
      .from("subscription_plans")
      .select("id", { count: "exact", head: true })
      .eq("active", true),
    supabase
      .from("quotations")
      .select("net_total, created_at")
      .gte("created_at", weekStarts()[0].toISOString())
      .returns<QuotationRow[]>(),
    supabase
      .from("config_audit_log")
      .select(
        "id, actor_id, actor_name, entity, entity_id, entity_label, action, field, old_value, new_value, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(AUDIT_PAGE_SIZE)
      .returns<AuditLogRow[]>(),
    countUsers(),
  ]);

  const error =
    products.error?.message ??
    rules.error?.message ??
    warehouses.error?.message ??
    plans.error?.message ??
    quotations.error?.message ??
    audit.error?.message;

  if (error) {
    return {
      stats: { ...EMPTY_ADMIN_STATS, ...users },
      volume: emptyVolume(),
      audit: [],
      loadError: error,
    };
  }

  return {
    stats: {
      ...users,
      products: products.count ?? 0,
      discountRules: rules.count ?? 0,
      warehouses: warehouses.count ?? 0,
      subscriptionPlans: plans.count ?? 0,
    },
    volume: buildVolume(quotations.data ?? []),
    audit: audit.data ?? [],
    loadError: null,
  };
}

/* ------------------------------------------------------------------ *
 * Deal volume
 * ------------------------------------------------------------------ */

/**
 * Net value of every quotation raised, bucketed by the week it was created.
 * Company-wide: an admin's RLS policy sees all reps, so no owner filter applies.
 */
function buildVolume(rows: QuotationRow[]): DealVolumePoint[] {
  const buckets = new Map<string, DealVolumePoint>();

  for (const weekStart of weekStarts()) {
    buckets.set(isoDate(weekStart), {
      date: isoDate(weekStart),
      label: weekStart.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
      }),
      value: 0,
      count: 0,
    });
  }

  const keys = [...buckets.keys()];

  for (const row of rows) {
    if (!row.created_at) continue;

    const key = isoDate(startOfWeek(new Date(row.created_at)));
    // Rows older than the window are dropped rather than folded into week one,
    // which would put a false spike on the left edge of the chart.
    if (!keys.includes(key)) continue;

    const bucket = buckets.get(key)!;
    bucket.value += Number(row.net_total ?? 0);
    bucket.count += 1;
  }

  return [...buckets.values()].map((point) => ({
    ...point,
    value: Math.round(point.value * 100) / 100,
  }));
}

function emptyVolume(): DealVolumePoint[] {
  return buildVolume([]);
}

/** Monday of the week `date` falls in. */
function startOfWeek(date: Date): Date {
  const monday = new Date(date);
  monday.setHours(0, 0, 0, 0);
  // getDay() is Sunday-based; shift so Monday is 0.
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday;
}

function weekStarts(): Date[] {
  const thisMonday = startOfWeek(new Date());

  return Array.from({ length: VOLUME_WEEKS }, (_, index) => {
    const date = new Date(thisMonday);
    date.setDate(date.getDate() - (VOLUME_WEEKS - 1 - index) * 7);
    return date;
  });
}

/* ------------------------------------------------------------------ *
 * Users
 * ------------------------------------------------------------------ */

/**
 * Users live in Clerk, not the database. A failed lookup returns zeroes rather
 * than throwing — the rest of the dashboard is still worth rendering.
 */
async function countUsers(): Promise<Pick<AdminStats, "activeUsers" | "totalUsers">> {
  try {
    const client = await clerkClient();
    const since = Date.now() - ACTIVE_WITHIN_DAYS * 86_400_000;

    const [totalUsers, active] = await Promise.all([
      client.users.getCount(),
      // Clerk cannot filter its count endpoint on activity, so the active tally
      // comes from a list query. Reading `totalCount` rather than the returned
      // page keeps it right when more users match than one page holds.
      client.users.getUserList({ limit: 1, lastActiveAtAfter: since }),
    ]);

    return { totalUsers, activeUsers: active.totalCount };
  } catch {
    return { totalUsers: 0, activeUsers: 0 };
  }
}

/** Everyone on the instance, for the Users & Roles screen. */
export async function loadManagedUsers(): Promise<{
  users: ManagedUser[];
  loadError: string | null;
}> {
  try {
    const client = await clerkClient();
    const { data } = await client.users.getUserList({
      limit: USER_PAGE_SIZE,
      orderBy: "-created_at",
    });

    // Which accounts carry access of their own, so the row can say so without
    // a request per user.
    const supabase = createServerSupabaseClient();
    const { data: profiles } = await supabase
      .from("user_permission_profiles")
      .select("user_id, customized")
      .returns<{ user_id: string; customized: boolean }[]>();
    const { data: overrides } = await supabase
      .from("user_module_permissions")
      .select("user_id")
      .returns<{ user_id: string }[]>();

    const special = new Set<string>([
      ...(profiles ?? []).filter((p) => p.customized).map((p) => p.user_id),
      ...(overrides ?? []).map((o) => o.user_id),
    ]);

    return {
      users: data.map((user) => ({
        id: user.id,
        name:
          [user.firstName, user.lastName].filter(Boolean).join(" ") ||
          user.emailAddresses[0]?.emailAddress ||
          user.id,
        email: user.emailAddresses[0]?.emailAddress ?? null,
        role:
          typeof user.publicMetadata?.role === "string"
            ? user.publicMetadata.role
            : null,
        lastActiveAt: user.lastActiveAt
          ? new Date(user.lastActiveAt).toISOString()
          : null,
        createdAt: new Date(user.createdAt).toISOString(),
        customized: special.has(user.id),
      })),
      loadError: null,
    };
  } catch (error) {
    return {
      users: [],
      loadError: error instanceof Error ? error.message : "Could not reach Clerk",
    };
  }
}

/* ------------------------------------------------------------------ */

function isoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

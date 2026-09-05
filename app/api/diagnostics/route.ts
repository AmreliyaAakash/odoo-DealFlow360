import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { fetchRole } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase-server";

/**
 * Why is the app showing no data?
 *
 * Every layer here can fail silently and look identical from the outside: an
 * empty table. RLS does not raise "denied", it returns nothing. So this walks
 * the chain end to end and reports which link is broken.
 *
 * Signed-in only, and it reveals nothing about other accounts — a user sees the
 * claims of their own token and the row counts their own session can read.
 */

const TABLES = [
  "products",
  "discount_rules",
  "warehouses",
  "subscription_plans",
  "upsell_rules",
  "customers",
  "quotations",
  "quotation_lines",
  "approvals",
  "config_audit_log",
  "role_module_permissions",
] as const;

export type TableProbe = {
  table: string;
  /** Rows this session can actually read. */
  visible: number | null;
  status: "ok" | "empty" | "missing" | "error";
  detail?: string;
};

export type Diagnostics = {
  clerk: {
    userId: string;
    /** The role Clerk's API holds — the truth. */
    roleFromApi: string | null;
    /** The role carried on the session token — what RLS can see. */
    roleFromClaim: string | null;
    claimPresent: boolean;
    tokenClaims: string[];
  };
  database: {
    reachable: boolean;
    /** What Postgres resolves for this session. */
    clerkRole: string | null;
    isStaff: boolean | null;
    /** False when the permission layer of setup.sql has not been applied. */
    permissionLayerInstalled: boolean;
    error?: string;
  };
  tables: TableProbe[];
  verdict: { ok: boolean; headline: string; fix: string | null };
};

export async function GET() {
  const { userId, sessionClaims, getToken } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const roleFromClaim =
    typeof sessionClaims?.publicMetadata?.role === "string"
      ? sessionClaims.publicMetadata.role
      : null;

  const roleFromApi = await fetchRole(userId);

  // The token is decoded, not verified — Supabase does the verifying. We only
  // want to know which claims made it onto the wire.
  let tokenClaims: string[] = [];
  try {
    const token = await getToken();
    if (token) {
      const payload = JSON.parse(
        Buffer.from(token.split(".")[1], "base64").toString("utf8"),
      );
      tokenClaims = Object.keys(payload).sort();
    }
  } catch {
    tokenClaims = [];
  }

  const supabase = createServerSupabaseClient();

  // What Postgres itself resolves for this session. These are the exact
  // functions every policy is built on.
  let clerkRole: string | null = null;
  let isStaff: boolean | null = null;
  let dbError: string | undefined;
  let reachable = true;

  try {
    const [roleRpc, staffRpc] = await Promise.all([
      supabase.rpc("clerk_role"),
      supabase.rpc("is_staff"),
    ]);
    clerkRole = (roleRpc.data as string | null) ?? null;
    isStaff = (staffRpc.data as boolean | null) ?? null;
    if (roleRpc.error) dbError = roleRpc.error.message;
  } catch (cause) {
    reachable = false;
    dbError = cause instanceof Error ? cause.message : "Could not reach the database";
  }

  const tables: TableProbe[] = await Promise.all(
    TABLES.map(async (table): Promise<TableProbe> => {
      const { count, error } = await supabase
        .from(table)
        .select("*", { count: "exact", head: true });

      if (error) {
        const missing = error.code === "42P01" || error.code === "PGRST205";
        return {
          table,
          visible: null,
          status: missing ? "missing" : "error",
          detail: missing ? "table does not exist" : error.message,
        };
      }

      return {
        table,
        visible: count ?? 0,
        status: (count ?? 0) > 0 ? "ok" : "empty",
      };
    }),
  );

  const permissionLayerInstalled =
    tables.find((t) => t.table === "role_module_permissions")?.status !== "missing";

  const diagnostics: Diagnostics = {
    clerk: {
      userId,
      roleFromApi,
      roleFromClaim,
      claimPresent: roleFromClaim !== null,
      tokenClaims,
    },
    database: {
      reachable,
      clerkRole,
      isStaff,
      permissionLayerInstalled,
      error: dbError,
    },
    tables,
    verdict: verdictFor({
      roleFromApi,
      roleFromClaim,
      clerkRole,
      permissionLayerInstalled,
      tables,
    }),
  };

  return NextResponse.json(diagnostics);
}

/**
 * The first broken link, in the order a request actually travels. Reporting the
 * earliest failure matters: a missing role claim makes every table look empty,
 * and "seed your data" would be the wrong advice.
 */
function verdictFor(input: {
  roleFromApi: string | null;
  roleFromClaim: string | null;
  clerkRole: string | null;
  permissionLayerInstalled: boolean;
  tables: TableProbe[];
}): Diagnostics["verdict"] {
  if (!input.roleFromApi) {
    return {
      ok: false,
      headline: "This account has no role in Clerk",
      fix: "Set publicMetadata.role on the user (Clerk dashboard, or Users & Roles if you have an admin who can sign in).",
    };
  }

  if (!input.roleFromClaim || !input.clerkRole) {
    return {
      ok: false,
      headline: "The session token does not carry publicMetadata, so the database sees no role",
      fix: 'Clerk → Sessions → Customize session token, set: { "role": "authenticated", "publicMetadata": "{{user.public_metadata}}" }. Then sign out and back in — existing tokens keep the old shape until they refresh.',
    };
  }

  if (!input.permissionLayerInstalled) {
    return {
      ok: false,
      headline: "The database is on an older schema — the permission tables are missing",
      fix: "Run db/setup.sql in Supabase → SQL Editor. It is idempotent and safe to re-run.",
    };
  }

  const configEmpty = input.tables.find((t) => t.table === "products")?.visible === 0;
  if (configEmpty) {
    return {
      ok: false,
      headline: "Signed in and authorised, but the catalog is empty",
      fix: "Run db/setup.sql — the seed section fills products, warehouses and the demo pipeline.",
    };
  }

  return {
    ok: true,
    headline: "Everything resolves: role, token claim, schema and data",
    fix: null,
  };
}

import "server-only";
import { MODULE_LABELS, type Module } from "@/lib/permissions";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { nameFor, resolveUserNames } from "@/lib/users-server";
import { registerTool } from "../tool-registry";
import type { ChatTool } from "../types";

/**
 * Feature 8 — who was granted what, and when.
 *
 * `adminOnly`, which means the registry never puts it in a non-admin's tool
 * list and the agent loop refuses a call to a name it was not offered. Both
 * matter: this is the log of permission changes, so gating it on a module grant
 * would let whoever received a grant read the record of it being made.
 *
 * Two sources, because they answer different questions. `config_audit_log`
 * (entity 'users') is the history — what changed, by whom. The permission
 * tables are the present state — which accounts currently sit outside their
 * role's defaults.
 */

const MAX_SINCE_DAYS = 365;

type AuditRow = {
  actor_id: string;
  actor_name: string | null;
  entity_id: string | null;
  entity_label: string | null;
  action: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
};

const permissionAudit: ChatTool = {
  id: "permission_audit_log",
  description:
    "Admin only. Permission grant and revoke history from the config audit log, plus the " +
    "accounts whose access currently differs from their role's defaults.",
  module: null,
  minimum: "view",
  adminOnly: true,
  promptNote: `permission_audit_log is available only to an admin. If anyone else \
asks an audit question, say plainly that it needs admin access and stop — do not \
try to answer it from another tool.`,
  parameters: {
    type: "object",
    properties: {
      sinceDays: { type: "integer", description: "How far back (default 30, max 365)." },
      module: { type: "string", description: "Narrow to one module key, e.g. approvals." },
      limit: { type: "integer", description: "How many log entries (default 25, max 100)." },
    },
  },
  execute: async (args) => {
    const sinceDays = Math.min(Math.max(Number(args.sinceDays) || 30, 1), MAX_SINCE_DAYS);
    const limit = Math.min(Math.max(Number(args.limit) || 25, 1), 100);
    const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();

    const supabase = createServerSupabaseClient();

    const [log, overrides, profiles] = await Promise.all([
      supabase
        .from("config_audit_log")
        .select("actor_id, actor_name, entity_id, entity_label, action, field, old_value, new_value, created_at")
        .eq("entity", "users")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(limit),
      supabase
        .from("user_module_permissions")
        .select("user_id, module, capability, scope")
        .limit(500),
      supabase
        .from("user_permission_profiles")
        .select("user_id, customized")
        .eq("customized", true)
        .limit(500),
    ]);

    if (log.error) return { error: "Could not read the audit log." };

    const entries = (log.data ?? []) as AuditRow[];
    const grants = (overrides.data ?? []) as {
      user_id: string;
      module: string;
      capability: string;
      scope: string;
    }[];

    const wanted = typeof args.module === "string" ? args.module.trim() : "";
    const filtered = wanted
      ? grants.filter((row) => row.module === wanted)
      : grants;

    const names = await resolveUserNames([
      ...entries.map((entry) => String(entry.actor_id)),
      ...filtered.map((row) => row.user_id),
    ]);

    return {
      windowDays: sinceDays,
      changes: entries.map((entry) => ({
        at: entry.created_at,
        by: entry.actor_name ?? nameFor(names, String(entry.actor_id)),
        account: entry.entity_label ?? entry.entity_id,
        action: entry.action,
        field: entry.field,
        from: entry.old_value,
        to: entry.new_value,
      })),
      currentOverrides: filtered.map((row) => ({
        account: nameFor(names, row.user_id),
        module: MODULE_LABELS[row.module as Module] ?? row.module,
        capability: row.capability,
        rows: row.scope,
      })),
      // An account whose permissions were snapshotted no longer tracks its role:
      // editing the role stops reaching it, which is the thing that surprises
      // people later.
      accountsDetachedFromTheirRole: (profiles.data ?? []).length,
    };
  },
};

registerTool(permissionAudit);

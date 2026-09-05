"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SlidersIcon } from "@phosphor-icons/react";
import { Td, Tr } from "@/components/dashboard/panel";
import { cn } from "@/lib/utils";
import type { Role } from "@/types/globals";
import type { ManagedUser } from "../types";
import { PermissionEditor } from "./permission-editor";

const ASSIGNABLE: Role[] = ["rep", "manager", "finance", "admin", "customer"];

export const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  manager: "Sales Manager",
  finance: "Finance",
  rep: "Sales Rep",
  customer: "Customer (portal)",
  none: "No role",
};

export const ROLE_STYLES: Record<string, string> = {
  admin: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  manager: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  finance: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  rep: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  customer: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  none: "bg-muted text-muted-foreground",
};

/**
 * One account: its role, whether its access has been customized, and the way in
 * to the per-module editor.
 */
export function UserRow({
  user,
  index,
  isSelf,
}: {
  user: ManagedUser;
  index: number;
  /** The signed-in admin cannot demote themselves. */
  isSelf: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  async function changeRole(role: string) {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error ?? "Could not change the role");

      startTransition(() => router.refresh());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not change the role");
    } finally {
      setSaving(false);
    }
  }

  const busy = saving || pending;

  return (
    <>
      <Tr
        className="df-rise-in"
        style={{ "--df-delay": `${index * 30}ms` } as React.CSSProperties}
      >
        <Td className="font-medium">
          <span className="block truncate">{user.name}</span>
          {isSelf ? (
            <span className="block text-[10px] font-normal text-muted-foreground">
              that&apos;s you
            </span>
          ) : null}
        </Td>

        <Td className="text-muted-foreground">{user.email ?? "—"}</Td>

        <Td>
          <select
            value={user.role ?? ""}
            disabled={busy || isSelf}
            onChange={(event) => changeRole(event.target.value)}
            aria-label={`Role for ${user.name}`}
            title={
              isSelf ? "You cannot change your own role" : `Change ${user.name}'s role`
            }
            className={cn(
              "rounded-full px-2 py-1 text-[10px] font-medium outline-none ring-1 ring-transparent transition focus-visible:ring-violet-500 disabled:opacity-60",
              ROLE_STYLES[user.role ?? "none"],
            )}
          >
            {user.role === null ? <option value="">No role</option> : null}
            {ASSIGNABLE.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>

          {error ? (
            <span className="mt-1 block text-[10px] text-red-600 dark:text-red-400">
              {error}
            </span>
          ) : null}
        </Td>

        <Td>
          {user.role === "admin" ? (
            <span className="text-[10px] text-muted-foreground">
              Full access, not editable
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              disabled={!user.role}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium text-violet-600 transition-colors hover:bg-violet-500/10 disabled:opacity-50 dark:text-violet-400"
            >
              <SlidersIcon size={13} />
              {user.customized ? "Custom access" : "Module access"}
            </button>
          )}
        </Td>

        <Td className="text-right whitespace-nowrap text-muted-foreground">
          {user.lastActiveAt
            ? new Date(user.lastActiveAt).toLocaleDateString("en-IN", {
                day: "numeric",
                month: "short",
                year: "numeric",
              })
            : "Never"}
        </Td>
      </Tr>

      {editing ? (
        <PermissionEditor
          user={user}
          onClose={() => setEditing(false)}
          onSaved={() => startTransition(() => router.refresh())}
        />
      ) : null}
    </>
  );
}

"use client";

import { useState } from "react";
import { SlidersIcon } from "@phosphor-icons/react";
import { Td, Tr } from "@/components/dashboard/panel";
import { formatDate } from "@/lib/dates";
import { patchBody, useApiMutation } from "@/lib/use-api-mutation";
import { cn } from "@/lib/utils";
import { ROLE_LABELS, ROLE_STYLES } from "@/lib/roles";
import type { Role } from "@/types/globals";
import type { ManagedUser } from "../types";
import { PermissionEditor } from "./permission-editor";

const ASSIGNABLE: Role[] = ["rep", "manager", "finance", "admin", "customer"];

// Labels and accents come from lib/roles.ts; re-exported so existing importers
// of this module keep working.
export { ROLE_LABELS, ROLE_STYLES } from "@/lib/roles";

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
  const [editing, setEditing] = useState(false);

  // Pending state, the error toast and the server-component refresh all come
  // from the one hook now — this used to be twenty lines of the same thing.
  const roleChange = useApiMutation(`/api/admin/users/${user.id}`, {
    successMessage: `${user.name} updated`,
    errorMessage: "Could not change the role",
    refresh: true,
  });

  const busy = roleChange.pending;

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
            onChange={(event) => void roleChange.run(patchBody({ role: event.target.value }))}
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

          {roleChange.error ? (
            <span className="mt-1 block text-[10px] text-red-600 dark:text-red-400">
              {roleChange.error}
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
          {user.lastActiveAt ? formatDate(user.lastActiveAt) : "Never"}
        </Td>
      </Tr>

      {editing ? (
        <PermissionEditor
          user={user}
          onClose={() => setEditing(false)}
          onSaved={() => setEditing(false)}
        />
      ) : null}
    </>
  );
}

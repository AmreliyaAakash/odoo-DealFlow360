"use client";

import { useEffect, useState } from "react";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react";
import {
  CAPABILITIES,
  MODULES,
  MODULE_LABELS,
  type Access,
  type Capability,
  type Module,
} from "@/lib/permissions";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ManagedUser } from "../types";

type Payload = {
  role: string;
  editable: boolean;
  baseline: Record<Module, Access>;
  effective: Record<Module, Access>;
  customized: boolean;
};

const CAPABILITY_LABELS: Record<Capability, string> = {
  none: "No access",
  view: "View",
  use: "Use",
  write: "Edit",
  full: "Full",
};

/**
 * Per-account module access.
 *
 * The account inherits its role's column of the matrix; anything changed here is
 * stored as an exception on top. "Detach from role" takes the current set as a
 * standalone snapshot, after which editing the role no longer reaches this
 * account — the same two-mode model the reference CRM uses, because "give this
 * one person an extra module" and "this account is special now" are genuinely
 * different intentions.
 */
export function PermissionEditor({
  user,
  onClose,
  onSaved,
}: {
  user: ManagedUser;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [draft, setDraft] = useState<Record<Module, Access> | null>(null);
  const [customized, setCustomized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/admin/users/${user.id}/permissions`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error ?? "Could not load permissions");
        return body as Payload;
      })
      .then((body) => {
        if (cancelled) return;
        setData(body);
        setDraft(body.effective);
        setCustomized(body.customized);
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Could not load");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [user.id]);

  function setCapability(module: Module, capability: Capability) {
    setDraft((current) =>
      current === null
        ? current
        : {
            ...current,
            [module]: {
              capability,
              // Revoking a module drops its scope with it; otherwise keep
              // whatever scope the account already had, defaulting to all.
              scope:
                capability === "none"
                  ? "none"
                  : current[module].scope === "none"
                    ? "all"
                    : current[module].scope,
            },
          },
    );
  }

  async function save() {
    if (!draft || !data) return;

    setSaving(true);
    setError(null);
    try {
      // Only genuine differences from the role are stored. A customized account
      // stores everything, because it no longer has a role to differ from.
      const overrides = MODULES.filter((module) => {
        if (customized) return true;
        const base = data.baseline[module];
        return (
          base.capability !== draft[module].capability ||
          base.scope !== draft[module].scope
        );
      }).map((module) => ({
        module,
        capability: draft[module].capability,
        scope: draft[module].scope,
      }));

      const response = await fetch(`/api/admin/users/${user.id}/permissions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrides, customized }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error ?? "Could not save");

      onSaved();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  function resetToRole() {
    if (data) setDraft(data.baseline);
    setCustomized(false);
  }

  const changed =
    data && draft
      ? MODULES.filter(
          (m) =>
            data.baseline[m].capability !== draft[m].capability ||
            data.baseline[m].scope !== draft[m].scope,
        )
      : [];

  return (
    <Dialog open onOpenChange={(open) => (!open && !saving ? onClose() : undefined)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto rounded-xl sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Module access — {user.name}</DialogTitle>
          <DialogDescription>
            {data
              ? `Inherits the ${data.role} role. Anything you change here applies to this account only.`
              : "Loading…"}
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p className="rounded-lg bg-red-500/10 p-2 text-[11px] text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : null}

        {data && draft ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs" style={{ minWidth: "34rem" }}>
                <thead>
                  <tr className="text-left text-[11px] text-muted-foreground">
                    <th className="px-2 py-2 font-medium">Module</th>
                    <th className="w-28 px-2 py-2 font-medium">From role</th>
                    <th className="w-40 px-2 py-2 font-medium">This account</th>
                  </tr>
                </thead>
                <tbody>
                  {MODULES.map((module) => {
                    const base = data.baseline[module];
                    const now = draft[module];
                    const differs =
                      base.capability !== now.capability || base.scope !== now.scope;

                    return (
                      <tr key={module} className="border-t border-border/60">
                        <td className="px-2 py-2">
                          <span className="block font-medium">
                            {MODULE_LABELS[module]}
                          </span>
                          {now.scope !== "none" && now.scope !== "all" ? (
                            <span className="block text-[10px] text-muted-foreground">
                              {now.scope} rows only
                            </span>
                          ) : null}
                        </td>

                        <td className="px-2 py-2 text-muted-foreground">
                          {CAPABILITY_LABELS[base.capability]}
                        </td>

                        <td className="px-2 py-2">
                          <select
                            value={now.capability}
                            disabled={saving}
                            aria-label={`${MODULE_LABELS[module]} access`}
                            onChange={(event) =>
                              setCapability(module, event.target.value as Capability)
                            }
                            className={cn(
                              "w-full rounded-lg bg-muted/60 px-2 py-1.5 text-xs outline-none ring-1 transition focus-visible:ring-violet-500",
                              differs
                                ? "ring-violet-500/50"
                                : "ring-transparent",
                            )}
                          >
                            {CAPABILITIES.map((capability) => (
                              <option key={capability} value={capability}>
                                {CAPABILITY_LABELS[capability]}
                                {capability === base.capability ? " (role default)" : ""}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <label className="flex items-start gap-2 rounded-lg bg-muted/40 p-3">
              <input
                type="checkbox"
                checked={customized}
                disabled={saving}
                onChange={(event) => setCustomized(event.target.checked)}
                className="mt-0.5"
              />
              <span className="text-[11px]">
                <span className="font-medium">Detach from the role</span>
                <span className="block text-muted-foreground">
                  Saves the whole set above as this account&apos;s own. Later changes
                  to the {data.role} role stop affecting them.
                </span>
              </span>
            </label>

            <p className="text-[11px] text-muted-foreground">
              {changed.length === 0
                ? "No differences from the role."
                : `${changed.length} module${changed.length === 1 ? "" : "s"} differ from the role: ${changed
                    .map((m) => MODULE_LABELS[m])
                    .join(", ")}.`}
            </p>
          </>
        ) : null}

        <DialogFooter>
          <button
            type="button"
            onClick={resetToRole}
            disabled={saving || !data}
            className="mr-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            <ArrowCounterClockwiseIcon size={13} />
            Reset to role
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg bg-muted px-3 py-2 text-xs font-medium transition-colors hover:bg-muted/70 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || !draft}
            className="rounded-lg bg-violet-500 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-violet-400 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save access"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

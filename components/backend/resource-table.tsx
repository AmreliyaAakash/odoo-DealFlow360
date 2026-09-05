"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  PencilSimpleIcon,
  PlusIcon,
  TableIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { formatCurrency } from "@/lib/quotations";
import { cn } from "@/lib/utils";
import type { BackendEntity, EntityField } from "@/lib/backend-entities";
import type { ReferenceOptions } from "@/lib/reference-options";
import {
  DataTable,
  EmptyRow,
  Notice,
  Panel,
  PanelHeader,
  Td,
  Th,
  Tr,
} from "@/components/dashboard/panel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** A2–A5 — the admin config screens. */

export type ResourceRow = Record<string, unknown> & { id: string };

/** Columns whose numbers are money, so they render as rupees. */
const MONEY = new Set(["list_price", "cost", "unit_price"]);

export function ResourceTable({
  entity = null,
  title,
  fields,
  rows,
  canWrite = false,
  references = {},
}: {
  /** Omit for a read-only view that has no CRUD endpoint behind it. */
  entity?: BackendEntity | null;
  title: string;
  fields: EntityField[];
  rows: ResourceRow[];
  canWrite?: boolean;
  /** Choices for reference fields, keyed by field. */
  references?: ReferenceOptions;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<ResourceRow | null>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const writable = canWrite && entity !== null;

  function start(row: ResourceRow | null) {
    setEditing(row);
    setError(null);
    setDraft(
      Object.fromEntries(
        fields.map((field) => [
          field.key,
          row?.[field.key] === null || row?.[field.key] === undefined
            ? field.type === "select" && field.options
              ? field.options[0]
              : ""
            : String(row[field.key]),
        ]),
      ),
    );
    setOpen(true);
  }

  async function save() {
    setSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/backend/${entity}`, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing ? { id: editing.id, ...draft } : draft),
      });

      const body = await response.json();

      if (!response.ok) {
        setError(body?.error ?? "Could not save.");
        return;
      }

      setOpen(false);
      // The page is a Server Component, so re-fetch it rather than patching
      // local state — the audit trail below updates in the same pass.
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  function labelFor(row: ResourceRow): string {
    return fields
      .slice(0, 2)
      .map((field) => render(row, field, references[field.key]))
      .filter((part) => part !== "—")
      .join(" · ");
  }

  async function remove(row: ResourceRow) {
    const label = labelFor(row);
    if (!window.confirm(`Deactivate "${label}"? It stays on historic quotations.`)) {
      return;
    }

    setBusyId(row.id);
    setError(null);

    try {
      const response = await fetch(`/api/backend/${entity}?id=${row.id}`, {
        method: "DELETE",
      });
      const body = await response.json();

      if (!response.ok) {
        setError(body?.error ?? "Could not deactivate.");
        return;
      }
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Panel>
      <PanelHeader
        icon={TableIcon}
        title={title}
        caption={`${rows.length} configured`}
      >
        {writable ? (
          <button
            type="button"
            onClick={() => start(null)}
            className="flex items-center gap-1.5 rounded-lg bg-zinc-900 px-2.5 py-1.5 text-[11px] font-medium text-zinc-50 transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
          >
            <PlusIcon size={12} weight="bold" />
            New
          </button>
        ) : null}
      </PanelHeader>

      {error && !open ? (
        <div className="mt-3">
          <Notice tone="danger">{error}</Notice>
        </div>
      ) : null}

      <div className="mt-3">
        <DataTable
          minWidth="40rem"
          head={
            <>
              {fields.map((field) => (
                <Th
                  key={field.key}
                  className={field.type === "number" ? "text-right" : undefined}
                >
                  {field.label}
                </Th>
              ))}
              <Th className="w-20" />
            </>
          }
        >
          {rows.map((row, index) => (
            <Tr
              key={row.id}
              className={cn("df-rise-in", row.active === false && "opacity-50")}
              style={{ "--df-delay": `${Math.min(index * 30, 400)}ms` } as React.CSSProperties}
            >
              {fields.map((field, column) => (
                <Td
                  key={field.key}
                  className={cn(
                    field.type === "number" && "text-right tabular-nums",
                    column === 0 ? "font-medium" : "text-muted-foreground",
                  )}
                >
                  {render(row, field, references[field.key])}
                </Td>
              ))}
              <Td>
                {writable ? (
                  <span className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => start(row)}
                      aria-label={`Edit ${labelFor(row)}`}
                      className="text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <PencilSimpleIcon size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(row)}
                      disabled={busyId === row.id || row.active === false}
                      aria-label={`Deactivate ${labelFor(row)}`}
                      className="text-muted-foreground transition-colors hover:text-destructive disabled:opacity-30"
                    >
                      <TrashIcon size={14} />
                    </button>
                  </span>
                ) : null}
              </Td>
            </Tr>
          ))}

          {rows.length === 0 ? (
            <EmptyRow colSpan={fields.length + 1}>Nothing configured yet.</EmptyRow>
          ) : null}
        </DataTable>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-xl">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${title}` : `New ${title}`}</DialogTitle>
            <DialogDescription>
              {editing
                ? "Changes are recorded in the audit trail."
                : "This is added to the catalog immediately."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            {fields.map((field) => {
              const locked = Boolean(editing && field.immutable);

              return (
                <label key={field.key} className="flex flex-col gap-1">
                  <span className="text-[11px] text-muted-foreground">
                    {field.label}
                    {field.required ? " *" : ""}
                    {locked ? " (cannot be changed)" : ""}
                  </span>

                  {field.type === "boolean" ? (
                    <span className="flex h-8 items-center">
                      <input
                        type="checkbox"
                        checked={draft[field.key] === "true"}
                        disabled={locked}
                        onChange={(event) =>
                          setDraft((d) => ({
                            ...d,
                            [field.key]: String(event.target.checked),
                          }))
                        }
                        className="size-4 accent-indigo-500 disabled:opacity-60"
                      />
                    </span>
                  ) : field.type === "reference" ? (
                    <select
                      value={draft[field.key] ?? ""}
                      disabled={locked}
                      onChange={(event) =>
                        setDraft((d) => ({ ...d, [field.key]: event.target.value }))
                      }
                      className="h-8 rounded-lg bg-muted/60 px-2.5 text-xs outline-none ring-1 ring-transparent transition focus-visible:bg-background focus-visible:ring-indigo-500 disabled:opacity-60"
                    >
                      {/* Always offered, even on a required field: the API
                          rejects the blank with the field's own name, which
                          reads better than a dropdown that pre-picked something
                          nobody chose. */}
                      <option value="">
                        {field.required ? "Choose…" : "None"}
                      </option>
                      {(references[field.key] ?? []).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  ) : field.type === "select" && field.options ? (
                    <select
                      value={draft[field.key] ?? ""}
                      disabled={locked}
                      onChange={(event) =>
                        setDraft((d) => ({ ...d, [field.key]: event.target.value }))
                      }
                      className="h-8 rounded-lg bg-muted/60 px-2.5 text-xs outline-none ring-1 ring-transparent transition focus-visible:bg-background focus-visible:ring-indigo-500 disabled:opacity-60"
                    >
                      {field.options.map((option) => (
                        <option key={option} value={option}>
                          {option.replace(/_/g, " ")}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={field.type === "number" ? "number" : "text"}
                      value={draft[field.key] ?? ""}
                      disabled={locked}
                      min={field.min}
                      max={field.max}
                      onChange={(event) =>
                        setDraft((d) => ({ ...d, [field.key]: event.target.value }))
                      }
                      className="h-8 rounded-lg bg-muted/60 px-2.5 text-xs outline-none ring-1 ring-transparent transition focus-visible:bg-background focus-visible:ring-indigo-500 disabled:opacity-60"
                    />
                  )}

                  {field.hint ? (
                    <span className="text-[10px] text-muted-foreground">
                      {field.hint}
                    </span>
                  ) : null}
                </label>
              );
            })}
          </div>

          {error && open ? <Notice tone="danger">{error}</Notice> : null}

          <DialogFooter>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg bg-muted px-3 py-2 text-xs font-medium transition-colors hover:bg-muted/70"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-lg bg-indigo-500 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-indigo-400 disabled:opacity-50"
            >
              {saving ? "Saving..." : editing ? "Save changes" : "Create"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}

function render(
  row: ResourceRow,
  field: EntityField,
  options?: { value: string; label: string }[],
): string {
  const value = row[field.key];

  // A flag reads before the empty check: false is an answer, not a blank.
  if (field.type === "boolean") return value === true || value === "true" ? "Yes" : "No";

  if (value === null || value === undefined || value === "") return "—";

  if (field.type === "reference") {
    // An id with no match is a row pointing at something archived or deleted.
    // Saying so beats printing a uuid the admin cannot act on.
    const match = options?.find((option) => option.value === String(value));
    return match ? match.label : "Unavailable";
  }

  if (field.type === "number" && MONEY.has(field.key)) {
    return formatCurrency(Number(value));
  }
  if (field.key === "max_discount_pct") return `${Number(value).toFixed(0)}%`;
  if (field.type === "select") return String(value).replace(/_/g, " ");

  return String(value);
}

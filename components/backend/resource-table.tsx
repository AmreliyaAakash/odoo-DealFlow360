"use client";

import { useState } from "react";
import { PencilSimpleIcon, PlusIcon, TableIcon } from "@phosphor-icons/react";
import {
  DataTable,
  EmptyRow,
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

/**
 * A2–A5 — shared shell for the admin config screens: a table plus a dialog-based
 * create/edit form. STRUCTURE ONLY — persistence is not wired up.
 */

export type ResourceField = {
  key: string;
  label: string;
  type?: "text" | "number";
};

export type ResourceRow = Record<string, unknown> & { id: string };

export function ResourceTable({
  title,
  fields,
  rows,
}: {
  title: string;
  fields: ResourceField[];
  rows: ResourceRow[];
}) {
  const [editing, setEditing] = useState<ResourceRow | null>(null);
  const [open, setOpen] = useState(false);

  function start(row: ResourceRow | null) {
    setEditing(row);
    setOpen(true);
  }

  return (
    <Panel>
      <PanelHeader
        icon={TableIcon}
        title={title}
        caption={`${rows.length} configured`}
      >
        <button
          type="button"
          onClick={() => start(null)}
          className="flex items-center gap-1.5 rounded-lg bg-zinc-900 px-2.5 py-1.5 text-[11px] font-medium text-zinc-50 transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
        >
          <PlusIcon size={12} weight="bold" />
          New
        </button>
      </PanelHeader>

      <div className="mt-3">
        <DataTable
          minWidth="36rem"
          head={
            <>
              {fields.map((field) => (
                <Th key={field.key}>{field.label}</Th>
              ))}
              <Th className="w-16" />
            </>
          }
        >
          {rows.map((row, index) => (
            <Tr
              key={row.id}
              className="df-rise-in"
              style={{ "--df-delay": `${index * 35}ms` } as React.CSSProperties}
            >
              {fields.map((field, column) => (
                <Td
                  key={field.key}
                  className={
                    field.type === "number"
                      ? "text-right tabular-nums"
                      : column === 0
                        ? "font-medium"
                        : "text-muted-foreground"
                  }
                >
                  {String(row[field.key] ?? "—")}
                </Td>
              ))}
              <Td>
                <button
                  type="button"
                  onClick={() => start(row)}
                  aria-label={`Edit ${String(row[fields[0]?.key ?? "id"])}`}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  <PencilSimpleIcon size={14} />
                </button>
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
              {/* TODO(A2–A5): validate and persist via a server action or route. */}
              Not yet wired up — fields are read-only.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            {fields.map((field) => (
              <label key={field.key} className="flex flex-col gap-1">
                <span className="text-[11px] text-muted-foreground">
                  {field.label}
                </span>
                <input
                  type={field.type ?? "text"}
                  defaultValue={String(editing?.[field.key] ?? "")}
                  readOnly
                  className="h-8 rounded-lg bg-muted/60 px-2.5 text-xs outline-none ring-1 ring-transparent focus-visible:ring-indigo-500"
                />
              </label>
            ))}
          </div>

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
              disabled
              className="rounded-lg bg-indigo-500 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
            >
              Save
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}

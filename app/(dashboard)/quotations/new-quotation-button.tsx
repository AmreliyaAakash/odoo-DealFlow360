"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon, SpinnerIcon } from "@phosphor-icons/react";

export type CustomerOption = { id: string; name: string | null };

/**
 * Raises a draft quotation and goes straight to it.
 *
 * The customer is chosen here rather than in the builder because the builder has
 * no field for it: a draft created without one has no way back to being assigned,
 * so the choice belongs at the moment of creation.
 */
export function NewQuotationButton({ customers }: { customers: CustomerOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/quotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: customerId || null,
          reference: reference.trim() || null,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body?.error ?? "Could not create the quotation");
      }

      // `refresh` so the pipeline behind the dialog is not stale if the user
      // navigates back to it.
      router.refresh();
      router.push(`/quotations/${body.id}`);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not create the quotation",
      );
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-50 transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        <PlusIcon size={13} weight="bold" />
        New quotation
      </button>
    );
  }

  return (
    <div className="df-rise-in flex flex-wrap items-end gap-2 rounded-lg bg-card p-2 ring-1 ring-foreground/10">
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-muted-foreground">Customer</span>
        <select
          autoFocus
          value={customerId}
          onChange={(event) => setCustomerId(event.target.value)}
          className="h-8 w-48 rounded-lg bg-muted/60 px-2 text-xs outline-none ring-1 ring-transparent transition focus-visible:bg-background focus-visible:ring-indigo-500"
        >
          <option value="">Unassigned</option>
          {customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.name ?? customer.id}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-muted-foreground">Reference</span>
        <input
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          placeholder="Optional"
          className="h-8 w-40 rounded-lg bg-muted/60 px-2 text-xs outline-none ring-1 ring-transparent transition focus-visible:bg-background focus-visible:ring-indigo-500"
        />
      </label>

      <button
        type="button"
        onClick={() => void create()}
        disabled={saving}
        className="flex h-8 items-center gap-1.5 rounded-lg bg-zinc-900 px-3 text-xs font-medium text-zinc-50 transition-colors hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {saving ? (
          <SpinnerIcon size={13} className="animate-spin" />
        ) : (
          <PlusIcon size={13} weight="bold" />
        )}
        {saving ? "Creating" : "Create draft"}
      </button>

      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setError(null);
        }}
        disabled={saving}
        className="h-8 rounded-lg bg-muted px-3 text-xs font-medium transition-colors hover:bg-muted/70 disabled:opacity-50"
      >
        Cancel
      </button>

      {error ? (
        <p className="w-full text-[11px] text-red-600 dark:text-red-400">{error}</p>
      ) : null}
    </div>
  );
}

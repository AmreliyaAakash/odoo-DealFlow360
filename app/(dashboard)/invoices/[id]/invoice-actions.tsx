"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircleIcon, DownloadSimpleIcon } from "@phosphor-icons/react";
import { formatCurrency } from "@/lib/quotations";
import { Notice, Panel, PanelHeader } from "@/components/dashboard/panel";

/**
 * B7 — recording money against one invoice, and ending the subscription behind it.
 *
 * The amount defaults to whatever is outstanding, because that is what almost
 * every remittance settles; typing a smaller figure is the exception and the
 * field stays open for it.
 */
export function InvoiceActions({
  invoiceId,
  outstanding,
  recurring,
  settled,
  canWrite,
}: {
  invoiceId: string;
  outstanding: number;
  recurring: boolean;
  settled: boolean;
  /** False for a reviewer: they read the ledger but do not move it. */
  canWrite: boolean;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState<"pay" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (!canWrite) return null;

  async function post(kind: "pay" | "cancel", body: Record<string, unknown>) {
    setBusy(kind);
    setError(null);
    setDone(null);
    try {
      const response = await fetch(`/api/invoices/${invoiceId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();

      if (!response.ok) {
        setError(payload.error ?? "That did not go through");
        return;
      }

      setDone(
        kind === "pay"
          ? "Payment recorded."
          : "Subscription cancelled and a credit note raised for the unused days.",
      );
      setAmount("");
      setReference("");
      router.refresh();
    } catch {
      setError("Could not reach the billing service");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel delay={120}>
      <PanelHeader
        icon={CheckCircleIcon}
        title="Actions"
        caption={
          settled
            ? "This invoice is settled."
            : `${formatCurrency(outstanding)} outstanding`
        }
      />

      {error ? (
        <div className="mt-3">
          <Notice tone="danger">{error}</Notice>
        </div>
      ) : null}
      {done ? (
        <p className="mt-3 text-[11px] text-emerald-600 dark:text-emerald-400">
          {done}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-end gap-2">
        {settled ? null : (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-muted-foreground">Amount</span>
              <input
                type="number"
                min={0}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder={String(outstanding)}
                className="h-8 w-32 rounded-lg bg-muted/60 px-2 text-right text-xs tabular-nums outline-none ring-1 ring-transparent transition focus-visible:bg-background focus-visible:ring-indigo-500"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-muted-foreground">
                Reference (optional)
              </span>
              <input
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                placeholder="NEFT-0041"
                className="h-8 w-44 rounded-lg bg-muted/60 px-2 text-xs outline-none ring-1 ring-transparent transition focus-visible:bg-background focus-visible:ring-indigo-500"
              />
            </label>

            <button
              type="button"
              disabled={busy !== null}
              onClick={() =>
                void post("pay", {
                  amount: Number(amount === "" ? outstanding : amount),
                  reference,
                })
              }
              className="h-8 rounded-lg bg-emerald-500 px-3 text-xs font-medium text-white transition-colors hover:bg-emerald-400 disabled:opacity-50"
            >
              {busy === "pay" ? "Recording..." : "Record payment"}
            </button>
          </>
        )}

        <a
          href={`/api/reports?format=html&invoice=${invoiceId}`}
          target="_blank"
          rel="noreferrer"
          className="flex h-8 items-center gap-1.5 rounded-lg bg-muted px-3 text-xs font-medium transition-colors hover:bg-muted/70"
        >
          <DownloadSimpleIcon size={13} />
          Download summary
        </a>

        {recurring && !settled ? (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void post("cancel", { action: "change_quantity", qty: 0 })}
            title="Cancels the subscription and credits the unused days"
            className="h-8 rounded-lg px-3 text-xs font-medium text-red-600 transition-colors hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
          >
            {busy === "cancel" ? "Cancelling..." : "Cancel subscription"}
          </button>
        ) : null}
      </div>
    </Panel>
  );
}

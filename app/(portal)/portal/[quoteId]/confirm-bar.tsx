"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircleIcon, HandshakeIcon } from "@phosphor-icons/react";
import { formatCurrency, formatPercent } from "@/lib/quotations";
import { PORTAL_ACCENT, type PortalQuote } from "./types";

/**
 * B8 — the two decisions the customer actually gets to make.
 *
 * Counter and confirm sit together because they are the same choice seen from
 * two sides: take these terms, or ask for better ones. Splitting them across the
 * page would leave the customer hunting for the second half.
 *
 * Confirming is only offered on a quotation the desk has already cleared. While
 * a counter is with approvals the button says so rather than disappearing — a
 * customer who has just asked for more needs to know their request is moving,
 * not wonder whether the page broke.
 */
export function ConfirmBar({ quote }: { quote: PortalQuote }) {
  const router = useRouter();
  const [countering, setCountering] = useState(false);
  const [requested, setRequested] = useState("");
  const [note, setNote] = useState("");
  const [deliveryDate, setDeliveryDate] = useState(
    quote.requestedDeliveryDate ?? "",
  );
  const [busy, setBusy] = useState<"counter" | "confirm" | null>(null);
  const [message, setMessage] = useState<
    { tone: "ok" | "error"; text: string } | null
  >(null);

  const { awaitingDesk, canConfirm: confirmable, settled } = quote;

  async function act(action: "counter" | "confirm") {
    setBusy(action);
    setMessage(null);

    try {
      const response = await fetch(`/api/quotations/${quote.id}/portal-action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "counter"
            ? { action, discountPct: Number(requested), note }
            : { action, requestedDeliveryDate: deliveryDate || null },
        ),
      });
      const body = await response.json();

      if (!response.ok) {
        setMessage({ tone: "error", text: body.error ?? "That did not go through" });
        return;
      }

      setMessage({
        tone: "ok",
        text:
          action === "confirm"
            ? "Confirmed. Your account manager will arrange fulfilment."
            : body.reEnteredApproval
              ? "Sent. Your request needs sign-off from our desk — we will come back to you."
              : "Done. The new terms cleared our thresholds and your quotation has been updated.",
      });

      setCountering(false);
      setRequested("");
      setNote("");

      // The stage, totals and status all move on the server; re-rendering the
      // page is what brings them back rather than patching a copy here.
      router.refresh();
    } catch {
      setMessage({ tone: "error", text: "Could not reach us. Please try again." });
    } finally {
      setBusy(null);
    }
  }

  if (settled) {
    return (
      <section className="flex items-center gap-2 rounded-2xl bg-emerald-500/10 p-4 text-xs text-emerald-700 ring-1 ring-emerald-500/30 dark:text-emerald-400">
        <CheckCircleIcon size={16} weight="fill" />
        <span>
          You confirmed this quotation. Nothing further is needed from you.
          {quote.requestedDeliveryDate ? (
            <> Delivery requested by {quote.requestedDeliveryDate}.</>
          ) : null}
        </span>
      </section>
    );
  }

  return (
    <section className="rounded-2xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Your decision</h2>
          <p className="text-[11px] text-muted-foreground">
            {formatCurrency(quote.netTotal)} · currently{" "}
            {formatPercent(quote.maxDiscountPct / 100)} off
          </p>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted-foreground">
            Requested delivery date
          </span>
          <input
            type="date"
            value={deliveryDate}
            min={today()}
            onChange={(event) => setDeliveryDate(event.target.value)}
            disabled={!confirmable || busy !== null}
            className="h-8 rounded-lg bg-muted/60 px-2 text-xs outline-none ring-1 ring-transparent focus-visible:bg-background focus-visible:ring-sky-500 disabled:opacity-50"
          />
        </label>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setCountering((open) => !open)}
            disabled={busy !== null}
            className="flex items-center gap-1.5 rounded-lg bg-muted px-3 py-2 text-xs font-medium transition-colors hover:bg-muted/70 disabled:opacity-50"
          >
            <HandshakeIcon size={13} />
            {countering ? "Cancel" : "Counter the discount"}
          </button>

          <button
            type="button"
            onClick={() => void act("confirm")}
            disabled={!confirmable || busy !== null}
            title={
              confirmable
                ? undefined
                : "Available once this quotation clears our approvals desk"
            }
            className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-white transition-opacity disabled:opacity-40"
            style={{ background: PORTAL_ACCENT }}
          >
            <CheckCircleIcon size={13} weight="fill" />
            {busy === "confirm"
              ? "Confirming..."
              : awaitingDesk
                ? "With our desk"
                : "Confirm quotation"}
          </button>
        </div>
      </div>

      {countering ? (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-border/60 pt-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">
              Discount you are asking for
            </span>
            <span className="flex items-center gap-1">
              <input
                type="number"
                min={0}
                max={100}
                value={requested}
                onChange={(event) => setRequested(event.target.value)}
                placeholder={String(Math.ceil(quote.maxDiscountPct + 1))}
                className="h-8 w-24 rounded-lg bg-muted/60 px-2 text-xs tabular-nums outline-none ring-1 ring-transparent focus-visible:bg-background focus-visible:ring-sky-500"
              />
              <span className="text-xs text-muted-foreground">%</span>
            </span>
          </label>

          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">
              Anything we should know (optional)
            </span>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Budget is fixed this quarter…"
              className="h-8 w-full rounded-lg bg-muted/60 px-2 text-xs outline-none ring-1 ring-transparent focus-visible:bg-background focus-visible:ring-sky-500"
            />
          </label>

          <button
            type="button"
            onClick={() => void act("counter")}
            disabled={requested === "" || busy !== null}
            className="h-8 rounded-lg px-3 text-xs font-medium text-white transition-opacity disabled:opacity-40"
            style={{ background: PORTAL_ACCENT }}
          >
            {busy === "counter" ? "Sending..." : "Submit request"}
          </button>
        </div>
      ) : null}

      {message ? (
        <p
          className={
            message.tone === "ok"
              ? "mt-3 text-[11px] text-emerald-600 dark:text-emerald-400"
              : "mt-3 text-[11px] text-red-600 dark:text-red-400"
          }
        >
          {message.text}
        </p>
      ) : null}
    </section>
  );
}

/** Today as `YYYY-MM-DD`, so the picker cannot offer a date already past. */
function today(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
}

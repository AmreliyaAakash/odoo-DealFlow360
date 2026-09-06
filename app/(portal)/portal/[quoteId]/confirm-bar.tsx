"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircleIcon,
  ClockCountdownIcon,
  HandshakeIcon,
} from "@phosphor-icons/react";
import { formatCurrency, formatPercent } from "@/lib/quotations";
import { cn } from "@/lib/utils";
import { PORTAL_ACCENT, type PortalQuote } from "./types";

/**
 * B8 — the two decisions the customer actually gets to make.
 *
 * Counter and confirm sit together because they are the same choice seen from
 * two sides: take these terms, or ask for better ones. Splitting them across the
 * page would leave the customer hunting for the second half.
 *
 * Confirming is only offered on a quotation the desk has already cleared. While
 * a counter is with approvals the card says so rather than hiding the button — a
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
      <section className="flex items-start gap-3 rounded-2xl bg-emerald-500/10 p-5 text-xs text-emerald-800 ring-1 ring-emerald-500/30 dark:text-emerald-300">
        <CheckCircleIcon size={18} weight="fill" className="mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-semibold">You have confirmed this quotation</p>
          <p className="mt-0.5">
            Nothing further is needed from you.
            {quote.requestedDeliveryDate ? (
              <> Delivery requested by {quote.requestedDeliveryDate}.</>
            ) : null}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-sky-500/30">
      <header className="flex flex-wrap items-center gap-3 border-b border-border/60 bg-sky-500/5 px-5 py-3.5">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Your decision</h2>
          <p className="text-[11px] text-muted-foreground">
            {formatCurrency(quote.netTotal)} at{" "}
            {formatPercent(quote.maxDiscountPct / 100)} off list — accept these
            terms, or ask for better ones.
          </p>
        </div>
        {awaitingDesk ? (
          <span className="flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-700 ring-1 ring-amber-500/25 dark:text-amber-400">
            <ClockCountdownIcon size={12} />
            With our desk
          </span>
        ) : null}
      </header>

      <div className="flex flex-wrap items-end gap-4 p-5">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted-foreground">Requested delivery date</span>
          <input
            type="date"
            value={deliveryDate}
            min={today()}
            onChange={(event) => setDeliveryDate(event.target.value)}
            disabled={!confirmable || busy !== null}
            className="h-9 rounded-lg border border-border bg-background px-2.5 text-xs outline-none transition focus-visible:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-500/30 disabled:opacity-50"
          />
        </label>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setCountering((open) => !open)}
            disabled={busy !== null}
            className={cn(
              "flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50",
              countering && "bg-muted",
            )}
          >
            <HandshakeIcon size={14} />
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
            className="flex h-9 items-center gap-1.5 rounded-lg px-4 text-xs font-semibold text-white shadow-sm transition-opacity disabled:opacity-40"
            style={{ background: PORTAL_ACCENT }}
          >
            <CheckCircleIcon size={14} weight="fill" />
            {busy === "confirm"
              ? "Confirming…"
              : awaitingDesk
                ? "Awaiting our desk"
                : "Confirm quotation"}
          </button>
        </div>

        {!confirmable && !awaitingDesk ? (
          <p className="w-full text-[11px] text-muted-foreground">
            Confirmation opens once this quotation clears our approvals desk.
          </p>
        ) : null}
      </div>

      {countering ? (
        <div className="border-t border-border/60 bg-muted/30 px-5 py-4">
          <p className="mb-3 text-[11px] text-muted-foreground">
            Tell us the discount you are asking for. Anything within our
            thresholds is applied straight away; anything beyond them goes to
            the desk and we come back to you.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-muted-foreground">Discount requested</span>
              <span className="flex items-center gap-1">
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={requested}
                  onChange={(event) => setRequested(event.target.value)}
                  placeholder={String(Math.ceil(quote.maxDiscountPct + 1))}
                  className="h-9 w-24 rounded-lg border border-border bg-background px-2.5 text-xs tabular-nums outline-none transition focus-visible:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-500/30"
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
                className="h-9 w-full rounded-lg border border-border bg-background px-2.5 text-xs outline-none transition focus-visible:border-sky-500 focus-visible:ring-2 focus-visible:ring-sky-500/30"
              />
            </label>

            <button
              type="button"
              onClick={() => void act("counter")}
              disabled={requested === "" || busy !== null}
              className="h-9 rounded-lg px-4 text-xs font-semibold text-white shadow-sm transition-opacity disabled:opacity-40"
              style={{ background: PORTAL_ACCENT }}
            >
              {busy === "counter" ? "Sending…" : "Submit request"}
            </button>
          </div>
        </div>
      ) : null}

      {message ? (
        <p
          className={cn(
            "border-t border-border/60 px-5 py-3 text-[11px]",
            message.tone === "ok"
              ? "bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
              : "bg-red-500/5 text-red-600 dark:text-red-400",
          )}
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

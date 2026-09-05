"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SealCheckIcon } from "@phosphor-icons/react";
import { approvalLevelForRole, APPROVAL_LEVEL_NAMES } from "@/lib/permissions";
import type { Role } from "@/types/globals";
import { Notice, Panel, PanelHeader } from "@/components/dashboard/panel";

/**
 * B4 — the decision itself, with the reason attached.
 *
 * Reject and return take a written reason in a field rather than a browser
 * prompt: the reason lands in an audit trail somebody reads months later, and
 * a one-line modal is not where you write something you will be held to.
 */

type Action = "approve" | "reject" | "return";

export function ApprovalDecision({
  quotationId,
  reference,
  outstanding,
  decidable,
  canDecide,
  role,
}: {
  quotationId: string;
  reference: string;
  /** Levels this deal still needs, in escalation order. */
  outstanding: string[];
  /** False once the quotation has left `pending_approval`. */
  decidable: boolean;
  canDecide: boolean;
  role: Role | null;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!canDecide) return null;

  // An admin clears whichever tier is still outstanding; everybody else acts at
  // their own. Sending the level explicitly means the API refuses a manager
  // reaching for a finance-level sign-off rather than quietly downgrading it.
  const own = role ? approvalLevelForRole(role) : null;
  const level =
    role === "admin"
      ? (outstanding[0] ?? null)
      : own !== null
        ? APPROVAL_LEVEL_NAMES[own]
        : null;

  const mine = level !== null && outstanding.includes(level);

  async function decide(action: Action) {
    if (action !== "approve" && !reason.trim()) {
      setError("A reason is required to reject or return a quotation.");
      return;
    }

    setBusy(action);
    setError(null);

    try {
      const response = await fetch(`/api/quotations/${quotationId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          level,
          reason: action === "approve" ? reason.trim() || null : reason.trim(),
        }),
      });
      const body = await response.json();

      if (!response.ok) {
        setError(body?.error ?? "Could not record that decision.");
        return;
      }

      setReason("");
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel delay={140}>
      <PanelHeader
        icon={SealCheckIcon}
        title="Your decision"
        caption={
          !decidable
            ? `${reference} is not awaiting approval.`
            : level === null
              ? "Your role holds no approval tier."
              : mine
                ? `Recording a ${level} decision.`
                : `This deal is waiting on ${outstanding.join(" then ") || "nobody"}, not you.`
        }
      />

      {error ? (
        <div className="mt-3">
          <Notice tone="danger">{error}</Notice>
        </div>
      ) : null}

      {decidable && mine ? (
        <>
          <label className="mt-3 flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">
              Reason — required to reject or return, optional to approve
            </span>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              placeholder="Re-quote the support line at the standard tier…"
              className="w-full rounded-lg bg-muted/60 p-2 text-xs outline-none ring-1 ring-transparent transition focus-visible:bg-background focus-visible:ring-indigo-500"
            />
          </label>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void decide("approve")}
              className="rounded-lg bg-zinc-900 px-3.5 py-2 text-xs font-medium text-zinc-50 shadow-xs transition-colors hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              {busy === "approve" ? "Approving..." : "Approve"}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void decide("return")}
              className="rounded-lg border border-border bg-card px-3.5 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            >
              {busy === "return" ? "Returning..." : "Return for revision"}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void decide("reject")}
              className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3.5 py-2 text-xs font-medium text-rose-700 transition-colors hover:bg-rose-500/20 disabled:opacity-50 dark:bg-rose-500/20 dark:text-rose-400"
            >
              {busy === "reject" ? "Rejecting..." : "Reject"}
            </button>
          </div>
        </>
      ) : null}
    </Panel>
  );
}

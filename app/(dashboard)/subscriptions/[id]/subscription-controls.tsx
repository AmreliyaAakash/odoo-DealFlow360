"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react";
import {
  SUBSCRIPTION_TRANSITIONS,
  type SubscriptionStatus,
} from "@/lib/business-logic";
import { Notice, Panel, PanelHeader } from "@/components/dashboard/panel";

/**
 * B7 — modify or cancel a running subscription.
 *
 * The buttons are generated from the same transition table the API validates
 * against, so a move that would be refused is never offered in the first place.
 * That is why a cancelled subscription shows no buttons at all rather than a
 * "Resume" that fails.
 */

const LABELS: Record<SubscriptionStatus, string> = {
  active: "Resume",
  paused: "Pause",
  cancelled: "Cancel subscription",
};

export function SubscriptionControls({
  subscriptionId,
  status,
  canWrite,
}: {
  subscriptionId: string;
  status: SubscriptionStatus;
  /** False for a reviewer: they read the plan but do not change it. */
  canWrite: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<SubscriptionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const moves = SUBSCRIPTION_TRANSITIONS[status];

  async function move(next: SubscriptionStatus) {
    setBusy(next);
    setError(null);
    try {
      const response = await fetch(`/api/subscriptions/${subscriptionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const payload = await response.json();

      if (!response.ok) {
        setError(payload.error ?? "That did not go through");
        return;
      }

      router.refresh();
    } catch {
      setError("Could not reach the billing service");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel>
      <PanelHeader
        icon={ArrowsClockwiseIcon}
        title="Subscription"
        caption={
          status === "cancelled"
            ? "Cancelled. A returning customer needs a new subscription."
            : status === "paused"
              ? "Paused — it bills nothing and has no next bill date."
              : "Active and billing on schedule."
        }
      >
        {canWrite
          ? moves.map((next) => (
              <button
                key={next}
                type="button"
                disabled={busy !== null}
                onClick={() => void move(next)}
                className={
                  next === "cancelled"
                    ? "rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-red-600 transition-colors hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
                    : "rounded-lg bg-muted px-2.5 py-1.5 text-[11px] font-medium transition-colors hover:bg-muted/70 disabled:opacity-50"
                }
              >
                {busy === next ? "Saving..." : LABELS[next]}
              </button>
            ))
          : null}
      </PanelHeader>

      {error ? (
        <div className="mt-3">
          <Notice tone="danger">{error}</Notice>
        </div>
      ) : null}
    </Panel>
  );
}

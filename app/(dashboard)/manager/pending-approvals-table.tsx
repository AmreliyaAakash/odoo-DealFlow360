"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CaretRightIcon, StackIcon, WarningIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { riskBand } from "@/lib/business-logic";
import { formatCurrency, formatPercent } from "@/lib/quotations";
import { cn } from "@/lib/utils";
import { Notice, Panel, PanelHeader } from "@/components/dashboard/panel";
import type { PendingApproval } from "./types";

type Action = "approve" | "reject" | "return";

const RISK_STYLES = {
  low: { bar: "bg-emerald-500", text: "text-emerald-600 dark:text-emerald-400" },
  medium: { bar: "bg-amber-500", text: "text-amber-600 dark:text-amber-400" },
  high: { bar: "bg-red-500", text: "text-red-600 dark:text-red-400" },
} as const;

export function PendingApprovalsTable({ deals }: { deals: PendingApproval[] }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(deal: PendingApproval, action: Action) {
    // Reject and return must carry a reason; the API enforces it too.
    let reason: string | null = null;
    if (action !== "approve") {
      reason = window.prompt(
        `Why are you sending ${deal.reference} back?`,
        "",
      );
      if (reason === null) return;
      if (!reason.trim()) {
        setError("A reason is required to reject or return a quotation.");
        return;
      }
    }

    setBusyId(deal.id);
    setError(null);

    try {
      const response = await fetch(`/api/quotations/${deal.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason }),
      });

      const body = await response.json();

      if (!response.ok) {
        setError(body?.error ?? "Could not record that decision.");
        return;
      }

      // Re-fetch the server component so the queue and stats stay in step.
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Panel delay={320}>
      <PanelHeader
        icon={StackIcon}
        title="Pending Approvals"
        caption={`${deals.length} awaiting a decision, highest risk first`}
      />

      {error ? (
        <div className="mt-3">
          <Notice tone="danger">{error}</Notice>
        </div>
      ) : null}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[54rem] border-collapse text-xs">
          <thead>
            <tr className="text-left text-[11px] text-muted-foreground">
              <th className="w-8" />
              <th className="px-2 py-2 font-medium">Rep</th>
              <th className="px-2 py-2 font-medium">Customer</th>
              <th className="w-36 px-2 py-2 font-medium">Blended Risk</th>
              <th className="w-28 px-2 py-2 text-right font-medium">Amount</th>
              <th className="w-24 px-2 py-2 text-right font-medium">Lines</th>
              <th className="w-56 px-2 py-2 font-medium">Decision</th>
            </tr>
          </thead>
          <tbody>
            {deals.map((deal, index) => (
              <DealRows
                key={deal.id}
                deal={deal}
                index={index}
                expanded={expanded === deal.id}
                busy={busyId === deal.id}
                onToggle={() =>
                  setExpanded((current) => (current === deal.id ? null : deal.id))
                }
                onDecide={(action) => decide(deal, action)}
              />
            ))}

            {deals.length === 0 ? (
              <tr className="border-t border-border/60">
                <td colSpan={7} className="px-2 py-10 text-center text-muted-foreground">
                  Nothing is waiting on you.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function DealRows({
  deal,
  index,
  expanded,
  busy,
  onToggle,
  onDecide,
}: {
  deal: PendingApproval;
  index: number;
  expanded: boolean;
  busy: boolean;
  onToggle: () => void;
  onDecide: (action: Action) => void;
}) {
  const reduceMotion = useReducedMotion();
  const band = riskBand(deal.riskScore);
  const style = RISK_STYLES[band];
  const hasViolations = deal.violatingLines.length > 0;

  return (
    <>
      <motion.tr
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: Math.min(index * 0.04, 0.4) }}
        className={cn(
          "border-t border-border/60 transition-colors",
          expanded ? "bg-muted/40" : "hover:bg-muted/30",
        )}
      >
        <td className="px-1 py-2.5">
          {hasViolations ? (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={expanded}
              aria-label={`${expanded ? "Hide" : "Show"} violating lines for ${deal.reference}`}
              className="flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
            >
              <motion.span
                animate={{ rotate: expanded ? 90 : 0 }}
                transition={{ duration: 0.2 }}
                className="flex"
              >
                <CaretRightIcon size={12} weight="bold" />
              </motion.span>
            </button>
          ) : null}
        </td>

        <td className="px-2 py-2.5">
          <Link
            href={`/quotations/${deal.id}`}
            className="font-medium hover:text-amber-600 dark:hover:text-amber-400"
          >
            {deal.repName}
          </Link>
          <span className="block text-[11px] text-muted-foreground">
            {deal.reference}
          </span>
        </td>

        <td className="px-2 py-2.5">{deal.customer}</td>

        <td className="px-2 py-2.5">
          <span className="flex items-center gap-2">
            <span className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
              <motion.span
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(deal.riskScore, 100)}%` }}
                transition={{ duration: 0.6, delay: 0.2 + index * 0.04 }}
                className={cn("block h-full rounded-full", style.bar)}
              />
            </span>
            <span className={cn("font-medium tabular-nums", style.text)}>
              {deal.riskScore}
            </span>
          </span>
          <span className="block text-[11px] text-muted-foreground tabular-nums">
            {deal.maxDiscountPct.toFixed(0)}% off · {formatPercent(deal.marginPct)} margin
          </span>
        </td>

        <td className="px-2 py-2.5 text-right font-medium tabular-nums">
          {formatCurrency(deal.amount)}
        </td>

        <td className="px-2 py-2.5 text-right">
          {hasViolations ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400">
              <WarningIcon size={10} weight="fill" />
              {deal.violatingLines.length}
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground">none</span>
          )}
        </td>

        <td className="px-2 py-2.5">
          <div className="flex gap-1">
            <DecisionButton
              label="Approve"
              tone="approve"
              busy={busy}
              onClick={() => onDecide("approve")}
            />
            <DecisionButton
              label="Reject"
              tone="reject"
              busy={busy}
              onClick={() => onDecide("reject")}
            />
            <DecisionButton
              label="Return"
              tone="return"
              busy={busy}
              onClick={() => onDecide("return")}
            />
          </div>
        </td>
      </motion.tr>

      <AnimatePresence initial={false}>
        {expanded ? (
          <tr>
            <td colSpan={7} className="p-0">
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { duration: 0.28, ease: [0.22, 1, 0.36, 1] }
                }
                className="overflow-hidden"
              >
                <div className="border-t border-border/60 bg-muted/30 px-4 py-3">
                  <p className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                    Violating lines
                  </p>

                  <ul className="mt-2 flex flex-col gap-1.5">
                    {deal.violatingLines.map((line) => (
                      <li
                        key={line.id}
                        className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg bg-card px-2.5 py-2 ring-1 ring-foreground/5"
                      >
                        <span className="text-xs font-medium">{line.productName}</span>
                        <span className="text-[11px] tabular-nums text-muted-foreground">
                          {line.qty} × {formatCurrency(line.unitPrice)}
                        </span>
                        <span className="rounded-full bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-red-600 dark:text-red-400">
                          {line.discountPct.toFixed(1)}%
                        </span>
                        <span className="ml-auto text-[11px] text-muted-foreground">
                          {line.rule}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </motion.div>
            </td>
          </tr>
        ) : null}
      </AnimatePresence>
    </>
  );
}

const TONES = {
  approve: "bg-emerald-500 text-white hover:bg-emerald-400",
  reject: "bg-red-500/10 text-red-600 hover:bg-red-500/20 dark:text-red-400",
  return: "bg-muted hover:bg-muted/70",
} as const;

function DecisionButton({
  label,
  tone,
  busy,
  onClick,
}: {
  label: string;
  tone: keyof typeof TONES;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={cn(
        "rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-colors disabled:opacity-50",
        TONES[tone],
      )}
    >
      {label}
    </button>
  );
}

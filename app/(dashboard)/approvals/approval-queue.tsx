"use client";

import { useState } from "react";
import Link from "next/link";
import { SealCheckIcon, WarningIcon } from "@phosphor-icons/react";
import { approvalLevelForRole } from "@/lib/permissions";
import { formatCurrency } from "@/lib/quotations";
import { useRole } from "@/lib/use-role";
import { cn } from "@/lib/utils";
import {
  DataTable,
  EmptyRow,
  Panel,
  PanelHeader,
  Td,
  Th,
  Tr,
} from "@/components/dashboard/panel";

/** STRUCTURE ONLY — risk scoring and violation detail are placeholders. */

export type ViolatingLine = {
  id: string;
  productName: string;
  discountPct: number;
  rule: string;
};

export type PendingQuotation = {
  id: string;
  reference: string | null;
  customer: string | null;
  netTotal: number;
  /** Blended risk score, 0–100. */
  riskScore: number;
  violatingLines: ViolatingLine[];
};

type Action = "approve" | "reject" | "return";

const ACTION_STYLES: Record<Action, string> = {
  approve: "bg-emerald-500 text-white hover:bg-emerald-400",
  reject: "bg-red-500/10 text-red-600 hover:bg-red-500/20 dark:text-red-400",
  return: "bg-muted hover:bg-muted/70",
};

export function ApprovalQueue({ quotations }: { quotations: PendingQuotation[] }) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const { role, loaded, canWrite } = useRole();

  // A rep watches their own deals move through the queue but never decides on
  // one, so the controls are absent rather than present-and-disabled: a disabled
  // Approve button reads as "not yet", which is the wrong story.
  const mayDecide = loaded && canWrite("approvals");
  const level = approvalLevelForRole(role);

  async function decide(quotationId: string, action: Action) {
    setPendingId(quotationId);
    try {
      // TODO(B4): collect a reason for reject/return before sending, and refresh
      // the queue from the response.
      await fetch(`/api/quotations/${quotationId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The tier is stated explicitly: the API refuses one this role may not
        // act at rather than silently choosing for us.
        body: JSON.stringify({ action, reason: null, level }),
      });
    } finally {
      setPendingId(null);
    }
  }

  return (
    <Panel delay={80}>
      <PanelHeader
        icon={SealCheckIcon}
        title={mayDecide ? "Waiting on you" : "In review"}
        caption={`${quotations.length} quotation${quotations.length === 1 ? "" : "s"}`}
      />

      <div className="mt-3">
        <DataTable
          minWidth="52rem"
          head={
            <>
              <Th>Quotation</Th>
              <Th>Customer</Th>
              <Th className="w-28 text-right">Value</Th>
              <Th className="w-24">Risk</Th>
              <Th>Violations</Th>
              {mayDecide ? <Th className="w-60" /> : null}
            </>
          }
        >
          {quotations.map((quotation, index) => (
            <Tr
              key={quotation.id}
              className="df-rise-in"
              style={{ "--df-delay": `${index * 40}ms` } as React.CSSProperties}
            >
              <Td className="font-medium">
                <Link
                  href={`/quotations/${quotation.id}`}
                  className="hover:text-indigo-600 dark:hover:text-indigo-400"
                >
                  {quotation.reference ?? quotation.id}
                </Link>
              </Td>
              <Td>{quotation.customer ?? "—"}</Td>
              <Td className="text-right font-medium tabular-nums">
                {formatCurrency(quotation.netTotal)}
              </Td>
              <Td>
                <RiskMeter score={quotation.riskScore} />
              </Td>
              <Td className="text-[11px] text-muted-foreground">
                {quotation.violatingLines.length === 0 ? (
                  "—"
                ) : (
                  <span className="flex flex-col gap-0.5">
                    {quotation.violatingLines.map((line) => (
                      <span key={line.id} className="flex items-center gap-1">
                        <WarningIcon size={11} className="text-amber-500" />
                        {line.productName} — {line.discountPct}% ({line.rule})
                      </span>
                    ))}
                  </span>
                )}
              </Td>
              {mayDecide ? (
                <Td>
                  <div className="flex gap-1">
                    {(["approve", "reject", "return"] as const).map((action) => (
                      <button
                        key={action}
                        type="button"
                        disabled={pendingId === quotation.id}
                        onClick={() => decide(quotation.id, action)}
                        className={cn(
                          "rounded-lg px-2.5 py-1.5 text-[11px] font-medium capitalize transition-colors disabled:opacity-50",
                          ACTION_STYLES[action],
                        )}
                      >
                        {action}
                      </button>
                    ))}
                  </div>
                </Td>
              ) : null}
            </Tr>
          ))}

          {quotations.length === 0 ? (
            <EmptyRow colSpan={mayDecide ? 6 : 5}>
              {mayDecide ? "Nothing is waiting on you." : "No deals in review."}
            </EmptyRow>
          ) : null}
        </DataTable>
      </div>
    </Panel>
  );
}

/** Risk as a bar plus its number — colour shifts amber then red. */
function RiskMeter({ score }: { score: number }) {
  const tone =
    score >= 70 ? "bg-red-500" : score >= 40 ? "bg-amber-500" : "bg-emerald-500";

  return (
    <span className="flex items-center gap-1.5">
      <span className="h-1.5 w-10 overflow-hidden rounded-full bg-muted">
        <span
          className={cn("block h-full rounded-full", tone)}
          style={{ width: `${Math.min(Math.max(score, 0), 100)}%` }}
        />
      </span>
      <span className="text-[11px] tabular-nums">{score}</span>
    </span>
  );
}

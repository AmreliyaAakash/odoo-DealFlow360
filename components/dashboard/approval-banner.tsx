import { CheckCircleIcon, WarningCircleIcon } from "@phosphor-icons/react/dist/ssr";
import type { RequiredApproval } from "@/lib/business-logic";
import { riskBand } from "@/lib/business-logic";
import { cn } from "@/lib/utils";

export type ApprovalVerdictView = {
  blendedRiskScore: number;
  needsManager: boolean;
  needsFinance: boolean;
  needsAdmin: boolean;
  /** Why each level is required. Optional — the banner reads fine without it. */
  requiredApprovals?: RequiredApproval[];
};

const RISK_TONES = {
  low: "text-emerald-700 dark:text-emerald-400",
  medium: "text-amber-700 dark:text-amber-400",
  high: "text-red-600 dark:text-red-400",
} as const;

/**
 * The verdict on a saved quotation: whether it can go straight out, or which
 * desks have to sign it off first.
 *
 * The levels are named individually rather than summarised as "needs approval",
 * because "who is this waiting on" is the only question the rep actually has.
 */
export function ApprovalBanner({ verdict }: { verdict: ApprovalVerdictView }) {
  const levels = [
    verdict.needsManager ? "Manager" : null,
    verdict.needsFinance ? "Finance" : null,
    verdict.needsAdmin ? "Admin" : null,
  ].filter((level): level is string => level !== null);

  const clear = levels.length === 0;
  const band = riskBand(verdict.blendedRiskScore);

  return (
    <div
      role="status"
      className={cn(
        "flex flex-col gap-2 rounded-xl p-3 text-xs ring-1",
        clear
          ? "bg-emerald-500/10 ring-emerald-500/30"
          : "bg-amber-500/10 ring-amber-500/30",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        {clear ? (
          <CheckCircleIcon
            size={15}
            weight="fill"
            className="shrink-0 text-emerald-600 dark:text-emerald-400"
          />
        ) : (
          <WarningCircleIcon
            size={15}
            weight="fill"
            className="shrink-0 text-amber-600 dark:text-amber-400"
          />
        )}

        <p
          className={cn(
            "font-medium",
            clear
              ? "text-emerald-700 dark:text-emerald-400"
              : "text-amber-700 dark:text-amber-400",
          )}
        >
          {clear
            ? "No approval required — quote is ready to send"
            : `This quote needs approval from: ${levels.join(" / ")}`}
        </p>

        <span className="ml-auto text-[11px] text-muted-foreground">
          Blended risk{" "}
          <span className={cn("font-semibold tabular-nums", RISK_TONES[band])}>
            {verdict.blendedRiskScore}
          </span>
          /100
        </span>
      </div>

      {verdict.requiredApprovals && verdict.requiredApprovals.length > 0 ? (
        <ul className="flex flex-col gap-0.5 pl-6 text-muted-foreground">
          {verdict.requiredApprovals.map((approval) => (
            <li key={`${approval.level}:${approval.reason}`}>
              <span className="capitalize">{approval.level}</span>: {approval.reason}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

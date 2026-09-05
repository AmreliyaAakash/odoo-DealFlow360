import { riskBand } from "@/lib/business-logic";
import { cn } from "@/lib/utils";

const STYLES = {
  low: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  medium: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  high: "bg-red-500/10 text-red-600 dark:text-red-400",
} as const;

/** Blended risk score as a colour-banded pill. */
export function RiskPill({ score }: { score: number }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium tabular-nums",
        STYLES[riskBand(score)],
      )}
    >
      {score}
    </span>
  );
}

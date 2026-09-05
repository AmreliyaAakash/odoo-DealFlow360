import { TIER_LABELS, type CustomerTier } from "@/lib/business-logic";
import { cn } from "@/lib/utils";

/** Colours run cool → warm with commercial standing, so tier reads at a glance. */
const TIER_STYLES: Record<CustomerTier, string> = {
  standard: "bg-zinc-500/15 text-zinc-600 dark:text-zinc-400",
  silver: "bg-slate-400/20 text-slate-600 dark:text-slate-300",
  gold: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  platinum: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400",
};

export function TierBadge({
  tier,
  className,
}: {
  tier: CustomerTier;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
        TIER_STYLES[tier],
        className,
      )}
    >
      {TIER_LABELS[tier]}
    </span>
  );
}

import { statusColor, statusLabel } from "@/lib/status";
import { cn } from "@/lib/utils";

/** Status pill, tinted from the shared palette. */
export function StatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const color = statusColor(status);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium capitalize",
        className,
      )}
      // Tinted from the same hex the charts use, at ~12% alpha.
      style={{ background: `${color}1f`, color }}
    >
      <span className="size-1.5 rounded-full" style={{ background: color }} />
      {statusLabel(status)}
    </span>
  );
}

/** Green under the threshold, red over it — used for discount depth. */
export function DiscountBadge({
  value,
  threshold = 25,
}: {
  value: number;
  threshold?: number;
}) {
  return (
    <span
      className={cn(
        "rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
        value > threshold
          ? "bg-red-500/10 text-red-600 dark:text-red-400"
          : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      )}
    >
      {value.toFixed(1)}%
    </span>
  );
}

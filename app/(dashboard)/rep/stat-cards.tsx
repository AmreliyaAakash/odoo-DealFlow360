"use client";

import Link from "next/link";
import {
  ArrowUpRightIcon,
  ClockCountdownIcon,
  FileTextIcon,
  PercentIcon,
  SealCheckIcon,
  StarIcon,
} from "@phosphor-icons/react";
import { formatNumber } from "@/lib/quotations";
import { useCountUp } from "@/lib/use-count-up";
import { cn } from "@/lib/utils";
import type { RepStats } from "./types";

type Tile = {
  label: string;
  value: number;
  format: "integer" | "percent";
  icon: typeof FileTextIcon;
  tint: string;
  caption: string;
  /** Where the corner arrow goes. */
  href: string;
  delta?: number;
};

export function StatCards({ stats }: { stats: RepStats }) {
  const tiles: Tile[] = [
    {
      label: "Active Quotations",
      value: stats.activeQuotations,
      format: "integer",
      icon: FileTextIcon,
      tint: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-300",
      caption: "in the pipeline",
      href: "/quotations",
    },
    {
      label: "Approved This Month",
      value: stats.approvedThisMonthPct,
      format: "percent",
      icon: SealCheckIcon,
      tint: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      caption: "vs last month",
      href: "/approvals",
      delta: stats.approvedDeltaPct,
    },
    {
      label: "Avg Discount Given",
      value: stats.avgDiscountPct,
      format: "percent",
      icon: PercentIcon,
      tint: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
      caption: "across active deals",
      href: "/deal-health",
    },
    {
      label: "Pending Responses",
      value: stats.pendingCustomerResponses,
      format: "integer",
      icon: ClockCountdownIcon,
      tint: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
      caption: "awaiting the customer",
      href: "/quotations",
    },
  ];

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1 rounded-full bg-foreground px-2 py-1 text-[10px] font-medium text-background">
          <StarIcon size={10} weight="fill" />
          {tiles.length} Metrics
        </span>
        <span className="rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground">
          Recalculated on every visit
        </span>
      </div>

      <h2 className="text-lg font-semibold tracking-tight">
        Your desk at a glance
      </h2>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {tiles.map((tile, index) => (
          <StatCard key={tile.label} tile={tile} index={index} />
        ))}
      </div>
    </section>
  );
}

function StatCard({ tile, index }: { tile: Tile; index: number }) {
  const animated = useCountUp(tile.value);
  const Icon = tile.icon;

  return (
    <article
      className="df-rise-in rounded-xl bg-card p-4 ring-1 ring-foreground/10"
      style={{ "--df-delay": `${index * 70}ms` } as React.CSSProperties}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-lg",
            tile.tint,
          )}
        >
          <Icon size={15} weight="fill" />
        </span>
        <p className="truncate text-xs font-medium">{tile.label}</p>

        <Link
          href={tile.href}
          aria-label={`Open ${tile.label}`}
          className="ml-auto shrink-0 text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowUpRightIcon size={13} />
        </Link>
      </div>

      <p className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">
        {tile.format === "percent"
          ? `${animated.toFixed(1)}%`
          : formatNumber(Math.round(animated))}
      </p>

      <div className="mt-1.5 flex items-center gap-1.5">
        {tile.delta === undefined ? null : (
          <span
            className={cn(
              "rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
              tile.delta >= 0
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "bg-red-500/10 text-red-600 dark:text-red-400",
            )}
          >
            {tile.delta >= 0 ? "+" : ""}
            {tile.delta.toFixed(1)} pts
          </span>
        )}
        <span className="text-[11px] text-muted-foreground">{tile.caption}</span>
      </div>
    </article>
  );
}

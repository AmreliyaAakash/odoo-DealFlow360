"use client";

import Link from "next/link";
import {
  ArrowUpRightIcon,
  BriefcaseIcon,
  SealCheckIcon,
  StackIcon,
  WarningOctagonIcon,
} from "@phosphor-icons/react";
import { motion, useReducedMotion } from "framer-motion";
import { formatNumber } from "@/lib/quotations";
import { cn } from "@/lib/utils";
import type { ManagerStats } from "./types";

type Tile = {
  label: string;
  value: number;
  icon: typeof StackIcon;
  tint: string;
  caption: string;
  href: string;
  /** Pulse the badge while this is non-zero. */
  pulse?: boolean;
  /** Tint the number when non-zero. */
  alarm?: boolean;
};

export function ManagerStatCards({ stats }: { stats: ManagerStats }) {
  const tiles: Tile[] = [
    {
      label: "Pending Approvals",
      value: stats.pendingApprovals,
      icon: StackIcon,
      tint: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
      caption: "waiting on you",
      href: "/approvals",
      pulse: true,
    },
    {
      label: "Approved Today",
      value: stats.approvedToday,
      icon: SealCheckIcon,
      tint: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      caption: "since midnight",
      href: "/approvals",
    },
    {
      label: "Team Deals In Progress",
      value: stats.teamDealsInProgress,
      icon: BriefcaseIcon,
      tint: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
      caption: "across the team",
      href: "/manager/pipeline",
    },
    {
      label: "High-Risk Deals",
      value: stats.highRiskDeals,
      icon: WarningOctagonIcon,
      tint: "bg-red-500/10 text-red-600 dark:text-red-400",
      caption: "risk score 70+",
      href: "/deal-health",
      alarm: true,
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map((tile, index) => (
        <StatCard key={tile.label} tile={tile} index={index} />
      ))}
    </div>
  );
}

function StatCard({ tile, index }: { tile: Tile; index: number }) {
  const reduceMotion = useReducedMotion();
  const Icon = tile.icon;
  const active = tile.value > 0;

  // Only the pending badge breathes, and only when there is something to act on.
  const pulsing = Boolean(tile.pulse) && active && !reduceMotion;

  return (
    <motion.article
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.07, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-xl bg-card p-4 ring-1 ring-foreground/10"
    >
      <div className="flex items-center gap-2">
        <motion.span
          animate={pulsing ? { scale: [1, 1.05, 1] } : { scale: 1 }}
          transition={
            pulsing
              ? { duration: 1.8, repeat: Infinity, ease: "easeInOut" }
              : { duration: 0.2 }
          }
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-lg",
            tile.tint,
          )}
        >
          <Icon size={15} weight="fill" />
        </motion.span>

        <p className="truncate text-xs font-medium">{tile.label}</p>

        <Link
          href={tile.href}
          aria-label={`Open ${tile.label}`}
          className="ml-auto shrink-0 text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowUpRightIcon size={13} />
        </Link>
      </div>

      <p
        className={cn(
          "mt-3 text-2xl font-semibold tracking-tight tabular-nums",
          tile.alarm && active && "text-red-600 dark:text-red-400",
          tile.pulse && active && "text-amber-600 dark:text-amber-400",
        )}
      >
        {formatNumber(tile.value)}
      </p>

      <p className="mt-1.5 text-[11px] text-muted-foreground">{tile.caption}</p>
    </motion.article>
  );
}

"use client";

import Link from "next/link";
import {
  ArrowUpRightIcon,
  ArrowsClockwiseIcon,
  CurrencyInrIcon,
  PackageIcon,
  SealCheckIcon,
} from "@phosphor-icons/react";
import { motion } from "framer-motion";
import { formatCurrency, formatNumber } from "@/lib/quotations";
import { useRole } from "@/lib/use-role";
import type { Module } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import type { FinanceStats } from "./types";

type Tile = {
  label: string;
  value: number;
  format: "count" | "currency";
  icon: typeof PackageIcon;
  tint: string;
  caption: string;
  href: string;
  /**
   * The module behind the screen this tile opens. A tile is a link with a
   * number on it, so a viewer without the module would be shown a figure they
   * may not read and a link that redirects.
   */
  module: Module;
  /** Tint the figure red once non-zero. */
  alarm?: boolean;
};

export function FinanceStatCards({ stats }: { stats: FinanceStats }) {
  const tiles: Tile[] = [
    {
      label: "Pending Finance Approvals",
      module: "approvals",
      value: stats.pendingFinanceApprovals,
      format: "count",
      icon: SealCheckIcon,
      tint: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      caption: "waiting on finance",
      href: "/approvals",
    },
    {
      label: "Active Subscriptions",
      module: "billing",
      value: stats.activeSubscriptions,
      format: "count",
      icon: ArrowsClockwiseIcon,
      tint: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
      caption: "committed and recurring",
      href: "/finance/billing",
    },
    {
      label: "Backordered Items",
      module: "warehouseSplit",
      value: stats.backorderedItems,
      format: "count",
      icon: PackageIcon,
      tint: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
      caption: "units short of demand",
      href: "/finance/fulfillment",
      alarm: true,
    },
    {
      label: "Monthly Recurring Revenue",
      module: "billing",
      value: stats.mrr,
      format: "currency",
      icon: CurrencyInrIcon,
      tint: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      caption: "all cadences, per month",
      href: "/finance/billing",
    },
  ];

  // Same matrix the pages and the API read, so a tile appears exactly when
  // the screen behind it would open.
  const { canView } = useRole();
  const visible = tiles.filter((tile) => canView(tile.module));

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {visible.map((tile, index) => (
        <StatCard key={tile.label} tile={tile} index={index} />
      ))}
    </div>
  );
}

function StatCard({ tile, index }: { tile: Tile; index: number }) {
  const Icon = tile.icon;
  const active = tile.value > 0;

  return (
    <motion.article
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.07, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-xl bg-card p-4 ring-1 ring-foreground/10"
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

      <p
        className={cn(
          "mt-3 text-2xl font-semibold tracking-tight tabular-nums",
          tile.alarm && active && "text-amber-600 dark:text-amber-400",
        )}
      >
        {tile.format === "currency"
          ? formatCurrency(tile.value)
          : formatNumber(tile.value)}
      </p>

      <p className="mt-1.5 text-[11px] text-muted-foreground">{tile.caption}</p>
    </motion.article>
  );
}

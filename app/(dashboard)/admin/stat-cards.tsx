"use client";

import Link from "next/link";
import {
  ArrowUpRightIcon,
  PackageIcon,
  PercentIcon,
  UsersThreeIcon,
  WarehouseIcon,
} from "@phosphor-icons/react";
import { motion } from "framer-motion";
import { formatNumber } from "@/lib/quotations";
import { cn } from "@/lib/utils";
import { ACTIVE_WITHIN_DAYS, type AdminStats } from "./types";

type Tile = {
  label: string;
  value: number;
  icon: typeof PackageIcon;
  tint: string;
  caption: string;
  href: string;
};

export function AdminStatCards({ stats }: { stats: AdminStats }) {
  const tiles: Tile[] = [
    {
      label: "Total Active Users",
      value: stats.activeUsers,
      icon: UsersThreeIcon,
      tint: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
      caption: `of ${formatNumber(stats.totalUsers)}, seen in ${ACTIVE_WITHIN_DAYS} days`,
      href: "/admin/users",
    },
    {
      label: "Discount Rules Configured",
      value: stats.discountRules,
      icon: PercentIcon,
      tint: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
      caption: "active approval thresholds",
      href: "/backend/discount-rules",
    },
    {
      label: "Warehouses",
      value: stats.warehouses,
      icon: WarehouseIcon,
      tint: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
      caption: "stocking locations",
      href: "/backend/warehouses",
    },
    {
      label: "Products Listed",
      value: stats.products,
      icon: PackageIcon,
      tint: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      caption: "sellable catalog items",
      href: "/backend/products",
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
  const Icon = tile.icon;

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

      <p className="mt-3 text-2xl font-semibold tracking-tight tabular-nums">
        {formatNumber(tile.value)}
      </p>

      <p className="mt-1.5 text-[11px] text-muted-foreground">{tile.caption}</p>
    </motion.article>
  );
}

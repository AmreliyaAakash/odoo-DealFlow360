"use client";

import Link from "next/link";
import {
  ArrowsClockwiseIcon,
  CaretRightIcon,
  PackageIcon,
  PercentIcon,
  SlidersIcon,
  WarehouseIcon,
} from "@phosphor-icons/react";
import { motion, useReducedMotion } from "framer-motion";
import { Panel, PanelHeader } from "@/components/dashboard/panel";
import { formatNumber } from "@/lib/quotations";
import { cn } from "@/lib/utils";
import type { AdminStats } from "./types";

type Module = {
  href: string;
  title: string;
  caption: string;
  icon: typeof PackageIcon;
  tint: string;
  count: number;
};

/** Shortcuts into the four backend CRUD screens, each showing what it holds. */
export function QuickConfig({ stats }: { stats: AdminStats }) {
  const reduceMotion = useReducedMotion();

  const modules: Module[] = [
    {
      href: "/backend/products",
      title: "Products",
      caption: "Catalog, pricing and cost",
      icon: PackageIcon,
      tint: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      count: stats.products,
    },
    {
      href: "/backend/discount-rules",
      title: "Discount Rules",
      caption: "Thresholds and approval levels",
      icon: PercentIcon,
      tint: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
      count: stats.discountRules,
    },
    {
      href: "/backend/warehouses",
      title: "Warehouses",
      caption: "Locations and stock on hand",
      icon: WarehouseIcon,
      tint: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
      count: stats.warehouses,
    },
    {
      href: "/backend/subscriptions",
      title: "Subscriptions",
      caption: "Plans, cadence and minimum term",
      icon: ArrowsClockwiseIcon,
      tint: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
      count: stats.subscriptionPlans,
    },
  ];

  return (
    <Panel delay={260}>
      <PanelHeader
        icon={SlidersIcon}
        title="Quick Config"
        caption="Jump straight into a backend module"
      />

      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
        {modules.map((module, index) => (
          <ModuleCard
            key={module.href}
            module={module}
            index={index}
            reduceMotion={Boolean(reduceMotion)}
          />
        ))}
      </div>
    </Panel>
  );
}

function ModuleCard({
  module,
  index,
  reduceMotion,
}: {
  module: Module;
  index: number;
  reduceMotion: boolean;
}) {
  const Icon = module.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.28 + index * 0.06, ease: [0.22, 1, 0.36, 1] }}
      // Scaling the wrapper rather than the link keeps the focus ring crisp.
      whileHover={reduceMotion ? undefined : { scale: 1.02 }}
      whileTap={reduceMotion ? undefined : { scale: 0.99 }}
    >
      <Link
        href={module.href}
        className="group flex items-center gap-3 rounded-xl bg-muted/40 p-3 ring-1 ring-transparent transition-colors hover:bg-violet-500/5 hover:ring-violet-500/30 focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:outline-none"
      >
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg",
            module.tint,
          )}
        >
          <Icon size={16} weight="fill" />
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-xs font-medium">{module.title}</span>
            <span className="shrink-0 rounded-full bg-background px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
              {formatNumber(module.count)}
            </span>
          </span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {module.caption}
          </span>
        </span>

        <CaretRightIcon
          size={13}
          className="shrink-0 text-muted-foreground transition-colors group-hover:text-violet-600 dark:group-hover:text-violet-400"
        />
      </Link>
    </motion.div>
  );
}

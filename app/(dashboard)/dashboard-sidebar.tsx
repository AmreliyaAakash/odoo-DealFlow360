"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import {
  ChartBarIcon,
  ChartLineUpIcon,
  GearIcon,
  HeartbeatIcon,
  ReceiptIcon,
  SealCheckIcon,
  SparkleIcon,
  SquaresFourIcon,
} from "@phosphor-icons/react";
import { formatCurrency } from "@/lib/quotations";
import { cn } from "@/lib/utils";
import type { Role } from "@/types/globals";
import type { WatchlistDeal } from "./rep/types";

type Item = {
  href: string;
  label: string;
  icon: typeof SquaresFourIcon;
};

const PRIMARY: Item[] = [
  { href: "/rep", label: "Dashboard", icon: SquaresFourIcon },
  { href: "/quotations", label: "My Quotations", icon: ReceiptIcon },
  { href: "/rep/upsell", label: "Upsell Suggestions", icon: SparkleIcon },
  { href: "/deal-health", label: "Deal Health", icon: HeartbeatIcon },
];

const APPROVER: Item = { href: "/approvals", label: "Approvals", icon: SealCheckIcon };
const REPORTS: Item = { href: "/reports", label: "Reports", icon: ChartBarIcon };
const BACKEND: Item = { href: "/backend/products", label: "Backend", icon: GearIcon };

const APPROVER_ROLES = new Set<Role>(["manager", "finance", "admin"]);

/** Human-readable role names for the profile row. */
const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  manager: "Manager",
  finance: "Finance",
  rep: "Sales Rep",
  none: "No role",
};

/**
 * The only navigation in the dashboard — there is no top bar. Items the user's
 * role cannot reach are not rendered, matching the gating in `proxy.ts`.
 */
export function DashboardSidebar({
  role,
  watchlist,
}: {
  role: Role | null;
  watchlist: WatchlistDeal[];
}) {
  const pathname = usePathname();

  const items = [
    ...PRIMARY,
    ...(role && APPROVER_ROLES.has(role) ? [APPROVER] : []),
    REPORTS,
    ...(role === "admin" ? [BACKEND] : []),
  ];

  return (
    <aside className="hidden w-60 shrink-0 flex-col self-start rounded-xl bg-card p-3 ring-1 ring-foreground/10 lg:sticky lg:top-4 lg:flex lg:max-h-[calc(100vh-2rem)]">
      <Link href="/rep" className="flex items-center gap-2 px-2 py-2">
        <span className="flex size-6 items-center justify-center rounded-md bg-indigo-500 text-[11px] font-bold text-white">
          D
        </span>
        <span className="text-sm font-semibold tracking-tight">DealFlow360</span>
      </Link>

      <nav className="mt-3 flex flex-col gap-0.5">
        {items.map((item) => {
          const active =
            pathname === item.href ||
            (item.href === "/backend/products" && pathname.startsWith("/backend"));
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs transition-colors",
                active
                  ? "bg-indigo-500/10 font-medium text-indigo-600 dark:text-indigo-300"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon size={16} weight={active ? "fill" : "regular"} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-6 flex items-center justify-between px-2.5">
        <span className="flex items-center gap-1.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
          <ChartLineUpIcon size={12} />
          My Pipeline
        </span>
        <span className="text-[10px] text-muted-foreground">{watchlist.length}</span>
      </div>

      <div className="mt-1 flex min-h-0 flex-col gap-0.5 overflow-y-auto">
        {watchlist.map((deal) => (
          <Link
            key={deal.id}
            href={`/quotations/${deal.id}`}
            className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 transition-colors hover:bg-muted"
          >
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium">{deal.customer}</span>
              <span className="block text-[11px] tabular-nums text-muted-foreground">
                {formatCurrency(deal.amount)}
              </span>
            </span>
            <span
              className={cn(
                "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
                deal.discountPct > 25
                  ? "bg-red-500/10 text-red-600 dark:text-red-400"
                  : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
              )}
            >
              −{deal.discountPct.toFixed(0)}%
            </span>
          </Link>
        ))}

        {watchlist.length === 0 ? (
          <p className="px-2.5 py-2 text-[11px] text-muted-foreground">
            No active deals.
          </p>
        ) : null}
      </div>

      <div className="mt-auto flex flex-col gap-3 pt-6">
        <div className="rounded-xl bg-zinc-900 p-3 text-zinc-100 dark:bg-zinc-800">
          <p className="text-xs font-semibold">Close deals faster</p>
          <p className="mt-0.5 text-[11px] text-zinc-400">
            Upsell suggestions lift margin on open quotes.
          </p>
          <Link
            href="/rep/upsell"
            className="mt-2 inline-flex rounded-lg bg-indigo-500 px-2.5 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-indigo-400"
          >
            See suggestions
          </Link>
        </div>

        <div className="flex items-center gap-2 rounded-lg px-2.5 py-2 ring-1 ring-border">
          <UserButton />
          <span className="min-w-0 text-[11px] text-muted-foreground capitalize">
            {ROLE_LABELS[role ?? "none"]}
          </span>
        </div>
      </div>
    </aside>
  );
}

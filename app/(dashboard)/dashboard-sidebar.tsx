"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import {
  ArrowsClockwiseIcon,
  ChartBarIcon,
  ChartLineUpIcon,
  GearIcon,
  HeartbeatIcon,
  ReceiptIcon,
  SealCheckIcon,
  SparkleIcon,
  SquaresFourIcon,
  TruckIcon,
  UsersThreeIcon,
  WarehouseIcon,
} from "@phosphor-icons/react";
import { formatCurrency } from "@/lib/quotations";
import { cn } from "@/lib/utils";
import type { Role } from "@/types/globals";
import type { WatchlistDeal } from "./rep/types";

type Item = {
  href: string;
  label: string;
  icon: typeof SquaresFourIcon;
  /** Also mark active for sub-routes of this href. */
  prefix?: string;
};

const REP_NAV: Item[] = [
  { href: "/rep", label: "Dashboard", icon: SquaresFourIcon },
  { href: "/quotations", label: "My Quotations", icon: ReceiptIcon },
  { href: "/rep/upsell", label: "Upsell Suggestions", icon: SparkleIcon },
  { href: "/deal-health", label: "Deal Health", icon: HeartbeatIcon },
];

const APPROVER_NAV: Item[] = [
  { href: "/manager", label: "Dashboard", icon: SquaresFourIcon },
  { href: "/approvals", label: "Pending Approvals", icon: SealCheckIcon },
  { href: "/manager/pipeline", label: "Team Pipeline", icon: UsersThreeIcon },
  { href: "/deal-health", label: "Deal Health & Anomalies", icon: HeartbeatIcon },
];

const FINANCE_NAV: Item[] = [
  { href: "/finance", label: "Dashboard", icon: SquaresFourIcon },
  { href: "/approvals", label: "Finance Approvals", icon: SealCheckIcon },
  { href: "/finance/fulfillment", label: "Fulfillment", icon: TruckIcon },
  {
    href: "/finance/billing",
    label: "Subscriptions & Billing",
    icon: ArrowsClockwiseIcon,
  },
  { href: "/finance/warehouses", label: "Warehouses", icon: WarehouseIcon },
];

const REPORTS: Item = { href: "/reports", label: "Reports", icon: ChartBarIcon };
const BACKEND: Item = {
  href: "/backend/products",
  label: "Backend",
  icon: GearIcon,
  prefix: "/backend",
};

/** Human-readable role names for the profile row. */
const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  manager: "Sales Manager",
  finance: "Finance",
  rep: "Sales Rep",
  none: "No role",
};

/**
 * One workspace per role family: the rep desk (indigo), the approver desk
 * (amber) and the finance desk (emerald). Accent classes are whole strings so
 * Tailwind's scanner can see them.
 */
const WORKSPACES = {
  rep: {
    nav: REP_NAV,
    home: "/rep",
    /** Only the rep desk shows their personal deal rail. */
    showPipeline: true,
    cta: {
      href: "/rep/upsell",
      title: "Close deals faster",
      body: "Upsell suggestions lift margin on open quotes.",
      label: "See suggestions",
    },
    logo: "bg-indigo-500",
    active: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-300",
    button: "bg-indigo-500 hover:bg-indigo-400",
  },
  manager: {
    nav: APPROVER_NAV,
    home: "/manager",
    showPipeline: false,
    cta: {
      href: "/approvals",
      title: "Keep the desk clear",
      body: "Review the riskiest deals first.",
      label: "Review queue",
    },
    logo: "bg-amber-500",
    active: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    button: "bg-amber-500 hover:bg-amber-400",
  },
  finance: {
    nav: FINANCE_NAV,
    home: "/finance",
    showPipeline: false,
    cta: {
      href: "/finance/fulfillment",
      title: "Clear the backlog",
      body: "Allocate stock before it ages into a backorder.",
      label: "Open fulfillment",
    },
    logo: "bg-emerald-500",
    active: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    button: "bg-emerald-500 hover:bg-emerald-400",
  },
} as const;

function workspaceFor(role: Role | null) {
  if (role === "finance") return WORKSPACES.finance;
  if (role === "manager" || role === "admin") return WORKSPACES.manager;
  return WORKSPACES.rep;
}

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
  const workspace = workspaceFor(role);

  const items = [
    ...workspace.nav,
    REPORTS,
    ...(role === "admin" ? [BACKEND] : []),
  ];

  return (
    <aside className="hidden w-60 shrink-0 flex-col self-start rounded-xl bg-card p-3 ring-1 ring-foreground/10 lg:sticky lg:top-4 lg:flex lg:max-h-[calc(100vh-2rem)]">
      <Link href={workspace.home} className="flex items-center gap-2 px-2 py-2">
        <span
          className={cn(
            "flex size-6 items-center justify-center rounded-md text-[11px] font-bold text-white",
            workspace.logo,
          )}
        >
          D
        </span>
        <span className="text-sm font-semibold tracking-tight">DealFlow360</span>
      </Link>

      <nav className="mt-3 flex flex-col gap-0.5">
        {items.map((item) => {
          const active =
            pathname === item.href ||
            (item.prefix ? pathname.startsWith(item.prefix) : false);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs transition-colors",
                active
                  ? cn("font-medium", workspace.active)
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <Icon size={16} weight={active ? "fill" : "regular"} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {workspace.showPipeline ? (
        <>
          <div className="mt-6 flex items-center justify-between px-2.5">
            <span className="flex items-center gap-1.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
              <ChartLineUpIcon size={12} />
              My Pipeline
            </span>
            <span className="text-[10px] text-muted-foreground">
              {watchlist.length}
            </span>
          </div>

          <div className="mt-1 flex min-h-0 flex-col gap-0.5 overflow-y-auto">
            {watchlist.map((deal) => (
              <Link
                key={deal.id}
                href={`/quotations/${deal.id}`}
                className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 transition-colors hover:bg-muted"
              >
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium">
                    {deal.customer}
                  </span>
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
                  -{deal.discountPct.toFixed(0)}%
                </span>
              </Link>
            ))}

            {watchlist.length === 0 ? (
              <p className="px-2.5 py-2 text-[11px] text-muted-foreground">
                No active deals.
              </p>
            ) : null}
          </div>
        </>
      ) : null}

      <div className="mt-auto flex flex-col gap-3 pt-6">
        <div className="rounded-xl bg-zinc-900 p-3 text-zinc-100 dark:bg-zinc-800">
          <p className="text-xs font-semibold">{workspace.cta.title}</p>
          <p className="mt-0.5 text-[11px] text-zinc-400">{workspace.cta.body}</p>
          <Link
            href={workspace.cta.href}
            className={cn(
              "mt-2 inline-flex rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-white transition-colors",
              workspace.button,
            )}
          >
            {workspace.cta.label}
          </Link>
        </div>

        <div className="flex items-center gap-2 rounded-lg px-2.5 py-2 ring-1 ring-border">
          <UserButton />
          <span className="min-w-0 text-[11px] text-muted-foreground">
            {ROLE_LABELS[role ?? "none"]}
          </span>
        </div>
      </div>
    </aside>
  );
}

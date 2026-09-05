"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import {
  ArrowsClockwiseIcon,
  ArrowsCounterClockwiseIcon,
  BriefcaseIcon,
  ChartBarIcon,
  ChartLineUpIcon,
  CurrencyInrIcon,
  HeartbeatIcon,
  PackageIcon,
  PercentIcon,
  ReceiptIcon,
  SealCheckIcon,
  StackIcon,
  SparkleIcon,
  SquaresFourIcon,
  TruckIcon,
  UsersThreeIcon,
  WarehouseIcon,
} from "@phosphor-icons/react";
import { type Module } from "@/lib/permissions";
import { formatCurrency } from "@/lib/quotations";
import { roleLabel } from "@/lib/roles";
import { useRole } from "@/lib/use-role";
import { cn } from "@/lib/utils";
import type { Role } from "@/types/globals";
import type { WatchlistDeal } from "./rep/types";

type Item = {
  href: string;
  label: string;
  icon: typeof SquaresFourIcon;
  /** Also mark active for sub-routes of this href. */
  prefix?: string;
  /**
   * The module this item opens. Items whose module the role cannot view are not
   * rendered — the same matrix the API enforces decides what appears here.
   */
  module?: Module;
};

/**
 * One navigation for the whole product, not one per role.
 *
 * Every entity is a tab, and every tab opens a list screen whose rows open a
 * detail screen. What a given account actually sees is decided by the same
 * permission matrix the API enforces — a rep opening this gets Quotations,
 * Upsell and Deal Health, and no amount of knowing the URL gets them Invoices.
 *
 * The alternative, a bespoke nav per role, is what produced the old layout where
 * Fulfilment lived under /finance and Products under /backend: the same entity
 * had a different address depending on who was looking at it.
 */
const ENTITY_NAV: Item[] = [
  {
    href: "/quotations",
    label: "Quotations",
    icon: ReceiptIcon,
    prefix: "/quotations",
    module: "quotationBuilder",
  },
  {
    href: "/approvals",
    label: "Approvals",
    icon: SealCheckIcon,
    prefix: "/approvals",
    module: "approvals",
  },
  {
    href: "/fulfillment",
    label: "Fulfillment",
    icon: TruckIcon,
    prefix: "/fulfillment",
    module: "warehouseSplit",
  },
  {
    href: "/subscriptions",
    label: "Subscriptions",
    icon: ArrowsClockwiseIcon,
    prefix: "/subscriptions",
    module: "billing",
  },
  {
    href: "/invoices",
    label: "Invoices",
    icon: CurrencyInrIcon,
    prefix: "/invoices",
    module: "billing",
  },
  {
    href: "/deal-health",
    label: "Deal Health",
    icon: HeartbeatIcon,
    module: "dealHealth",
  },
  {
    href: "/reports",
    label: "Reports",
    icon: ChartBarIcon,
    module: "reports",
  },
  {
    href: "/products",
    label: "Products",
    icon: PackageIcon,
    prefix: "/products",
    module: "products",
  },
];

/**
 * Desk setup. Split out because it is administration rather than daily work,
 * and because grouping it keeps the entity tabs above readable.
 */
const CONFIG_NAV: Item[] = [
  {
    href: "/discount-setup",
    label: "Discount & Approvals",
    icon: PercentIcon,
    module: "discountRules",
  },
  {
    href: "/backend/warehouses",
    label: "Warehouses",
    icon: WarehouseIcon,
    module: "warehouses",
  },
  {
    href: "/backend/stock",
    label: "Stock Levels",
    icon: StackIcon,
    module: "warehouses",
  },
  {
    href: "/backend/replenishment",
    label: "Reorder Rules",
    icon: ArrowsCounterClockwiseIcon,
    module: "warehouses",
  },
  {
    href: "/backend/subscriptions",
    label: "Subscription Plans",
    icon: ArrowsClockwiseIcon,
    module: "subscriptionPlans",
  },
  {
    href: "/backend/upsell-rules",
    label: "Upsell Rules",
    icon: SparkleIcon,
    module: "upsellRules",
  },
];

/** The rep's own tool, which is not an entity anybody else browses. */
const UPSELL: Item = {
  href: "/rep/upsell",
  label: "Upsell Suggestions",
  icon: SparkleIcon,
  module: "upsellPanel",
};

/** What each desk tab is called, in that role's own words. */
const DESK_LABELS: Record<string, string> = {
  rep: "My Desk",
  manager: "Manager Desk",
  finance: "Finance Desk",
  admin: "Admin Desk",
};

/** Admin-only, and not gated by a module: it is how modules are handed out. */
const USERS: Item = {
  href: "/admin/users",
  label: "Users & Roles",
  icon: UsersThreeIcon,
};

/**
 * The look of each desk, and where its Dashboard tab goes.
 *
 * Navigation is no longer part of this: every role now walks the same entity
 * list and sees the subset its permissions allow. What stays per role is the
 * accent — rep indigo, approver amber, finance emerald, admin violet — and the
 * home screen the Dashboard tab opens. Accent classes are whole strings so
 * Tailwind's scanner can see them.
 */
const WORKSPACES = {
  rep: {
    home: "/dashboard",
    desk: "/rep",
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
    home: "/dashboard",
    desk: "/manager",
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
    home: "/dashboard",
    desk: "/finance",
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
  admin: {
    home: "/dashboard",
    desk: "/admin",
    showPipeline: false,
    cta: {
      href: "/backend/products",
      title: "Keep the catalog honest",
      body: "Prices and discount tiers drive every approval.",
      label: "Open config",
    },
    logo: "bg-violet-500",
    active: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
    button: "bg-violet-500 hover:bg-violet-400",
  },
} as const;

function workspaceFor(role: Role | null) {
  if (role === "admin") return WORKSPACES.admin;
  if (role === "finance") return WORKSPACES.finance;
  if (role === "manager") return WORKSPACES.manager;
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
  const { canView } = useRole();

  // A customer has no internal workspace at all. The route guard keeps them out
  // of /(dashboard), so this only matters if that ever loosens.
  if (role === "customer") return null;

  const workspace = workspaceFor(role);

  const allowed = (item: Item) =>
    item.module === undefined || canView(item.module);

  // Filtered by the access the server resolved, so an account granted an extra
  // module sees its link, and one that had a module revoked does not.
  const dashboard: Item = {
    href: workspace.home,
    label: "Dashboard",
    icon: SquaresFourIcon,
  };
  // The role's own desk keeps a tab of its own. The shared Dashboard above is
  // a summary; the desk screens carry the rails, charts and controls that only
  // make sense for one role, and folding them together would either bury them
  // or show a rep a finance chart they cannot act on.
  const desk: Item = {
    href: workspace.desk,
    label: DESK_LABELS[role ?? "rep"],
    icon: BriefcaseIcon,
  };

  const items = [dashboard, desk, ...ENTITY_NAV, UPSELL].filter(allowed);
  const config = [
    ...CONFIG_NAV,
    ...(role === "admin" ? [USERS] : []),
  ].filter(allowed);

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

      {config.length > 0 ? (
        <>
          <p className="mt-6 px-2.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
            Configuration
          </p>
          <nav className="mt-1 flex flex-col gap-0.5">
            {config.map((item) => {
              const active = pathname === item.href;
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
        </>
      ) : null}

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
            {roleLabel(role)}
          </span>
        </div>
      </div>
    </aside>
  );
}

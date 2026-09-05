"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import {
  ArrowsClockwiseIcon,
  ArrowsCounterClockwiseIcon,
  BriefcaseIcon,
  CaretDownIcon,
  CaretLeftIcon,
  CaretRightIcon,
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
import { BrandMark } from "@/components/brand-mark";
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
    href: "/backend/price-lists",
    label: "Price Lists",
    icon: CurrencyInrIcon,
    module: "products",
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
  specialist: "My Desk",
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
      module: "upsellPanel" as Module,
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
      module: "approvals" as Module,
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
      module: "warehouseSplit" as Module,
      href: "/finance/fulfillment",
      title: "Clear the backlog",
      body: "Allocate stock before it ages into a backorder.",
      label: "Open fulfillment",
    },
    logo: "bg-emerald-500",
    active: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    button: "bg-emerald-500 hover:bg-emerald-400",
  },
  // A specialist has no desk of their own — there is no screen that would mean
  // "the specialist view", because two specialists may hold nothing in common.
  // They get the shared dashboard, a neutral accent, and whatever tabs the
  // modules an admin granted them put in the nav.
  specialist: {
    home: "/dashboard",
    desk: "/dashboard",
    showPipeline: false,
    cta: {
      module: "quotationBuilder" as Module,
      href: "/quotations",
      title: "Access set by your admin",
      body: "Only the modules you have been granted appear here.",
      label: "Open quotations",
    },
    logo: "bg-slate-500",
    active: "bg-slate-500/10 text-slate-700 dark:text-slate-300",
    button: "bg-slate-500 hover:bg-slate-400",
  },
  admin: {
    home: "/dashboard",
    desk: "/admin",
    showPipeline: false,
    cta: {
      module: "products" as Module,
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
  if (role === "specialist") return WORKSPACES.specialist;
  if (role === "finance") return WORKSPACES.finance;
  if (role === "manager") return WORKSPACES.manager;
  return WORKSPACES.rep;
}

/**
 * How the sidebar is laid out at a given width, as class strings.
 *
 * `rail` is null until somebody works the toggle, and null means "follow the
 * breakpoint" — the rail is the default on a narrow screen and the full column
 * the default on a wide one, decided by CSS. That matters for hydration: the
 * server cannot know the viewport, so the first render must not depend on it.
 * Once the toggle is used the choice becomes explicit and applies everywhere.
 */
function layout(rail: boolean | null) {
  return {
    width: rail === null ? "w-[4.25rem] lg:w-60" : rail ? "w-[4.25rem]" : "w-60",
    /** Text that collapses away with the column. */
    label: rail === null ? "hidden lg:inline" : rail ? "hidden" : "inline",
    /** Whole blocks — the CTA card, the pipeline rail — that only fit expanded. */
    block: rail === null ? "hidden lg:flex" : rail ? "hidden" : "flex",
    /** A row centres its icon when there is no label beside it. */
    row: rail === null ? "justify-center lg:justify-start" : rail ? "justify-center" : "",
    /**
     * The two toggles are mirror images and must never both show. Collapse sits
     * beside the wordmark and only exists while expanded; expand is a row of its
     * own under the mark, because a rail has no width to put a button beside
     * anything. Under `null` each follows the breakpoint, so a narrow screen
     * still gets a way out of the rail.
     */
    collapse: rail === null ? "hidden lg:flex" : rail ? "hidden" : "flex",
    expand: rail === null ? "flex lg:hidden" : rail ? "flex" : "hidden",
    expanded: rail === null ? null : !rail,
  };
}

/** One tab. Both navs render the same row, so they share one. */
function NavLink({
  item,
  active,
  accent,
  view,
}: {
  item: Item;
  active: boolean;
  accent: string;
  view: ReturnType<typeof layout>;
}) {
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      // The label is the accessible name when it is visible; when the column is
      // a rail it is gone from the layout, so the title carries it instead —
      // otherwise every tab would be an unnamed icon.
      title={item.label}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs transition-colors",
        view.row,
        active
          ? cn("font-medium", accent)
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <Icon size={16} weight={active ? "fill" : "regular"} className="shrink-0" />
      <span className={cn("truncate", view.label)}>{item.label}</span>
    </Link>
  );
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

  // Null until the user works the disclosure themselves, so the section can
  // follow the route until then and obey the click afterwards. Declared above
  // the customer early-return below to keep the hook order stable.
  const [configToggled, setConfigToggled] = useState<boolean | null>(null);

  // null until the toggle is used: see `layout`. Declared here with the other
  // hook so the customer early-return below cannot change the hook order.
  const [rail, setRail] = useState<boolean | null>(null);

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
  const config = [...CONFIG_NAV, ...(role === "admin" ? [USERS] : [])].filter(
    allowed,
  );

  // Admin holds every config module, which is seven rows on top of ten entity
  // tabs — more than the sidebar has height for. Collapsed by default so the
  // daily tabs stay visible, and opened when the current page is inside it, so
  // arriving from a link never hides where you are.
  const onConfigRoute = config.some((item) => pathname === item.href);
  const configOpen = configToggled ?? onConfigRoute;

  const view = layout(rail);

  const allNavItems = [...items, ...config];

  // Pick the single most specific active item
  const getActiveHref = () => {
    // 1. Exact match has highest priority
    const exact = allNavItems.find((i) => i.href === pathname);
    if (exact) return exact.href;

    // 2. Prefix match (longest matching prefix wins)
    const matchingPrefixes = allNavItems
      .filter((i) => {
        if (i.href === workspace.home) return false;
        if (i.prefix) {
          return pathname === i.prefix || pathname.startsWith(`${i.prefix}/`);
        }
        return pathname.startsWith(`${i.href}/`);
      })
      .sort((a, b) => {
        const lenA = (a.prefix || a.href).length;
        const lenB = (b.prefix || b.href).length;
        return lenB - lenA;
      });

    return matchingPrefixes[0]?.href ?? null;
  };

  const activeHref = getActiveHref();

  return (
    <aside
      className={cn(
        // Never `hidden`: a narrow screen gets the rail, not nothing. The width
        // is the only thing that animates — transitioning layout properties on
        // the children as well makes the whole column shudder rather than glide.
        "sticky top-4 flex max-h-[calc(100vh-2rem)] shrink-0 flex-col self-start rounded-xl bg-card p-3 ring-1 ring-foreground/10",
        "transition-[width] duration-300 ease-in-out motion-reduce:transition-none",
        view.width,
      )}
    >
      <div className={cn("flex items-center", view.row)}>
        <Link
          href={workspace.home}
          className="flex min-w-0 items-center rounded-lg px-1 py-2 transition-colors hover:bg-muted/40"
          title="DealFlow360"
        >
          <BrandMark size="md" priority wordmarkClassName={view.label} />
        </Link>

        {/* Sits in the flow rather than pinned to the edge, so it cannot land on
            top of the page content next to it at any width. */}
        <button
          type="button"
          onClick={() => setRail(!(view.expanded ?? true))}
          aria-expanded={view.expanded ?? undefined}
          aria-label={view.expanded === false ? "Expand sidebar" : "Collapse sidebar"}
          title={view.expanded === false ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "ml-auto flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
            view.collapse,
          )}
        >
          <CaretLeftIcon size={14} weight="bold" />
        </button>
      </div>

      {/* Expanding again is the one action a rail has no room to offer inline,
          so it gets its own full-width row under the mark. */}
      <button
        type="button"
        onClick={() => setRail(false)}
        aria-label="Expand sidebar"
        title="Expand sidebar"
        className={cn(
          "mt-1 items-center justify-center rounded-lg py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
          view.expand,
        )}
      >
        <CaretRightIcon size={14} weight="bold" />
      </button>

      {/* The one scrolling region. Without it the tail of a long nav is simply
          clipped by the sticky column's max height — there is no pipeline rail
          below it on an admin or finance desk to carry a scrollbar of its own. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <nav className="mt-3 flex flex-col gap-0.5">
          {items.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              active={item.href === activeHref}
              accent={workspace.active}
              view={view}
            />
          ))}
        </nav>

        {config.length > 0 ? (
          <>
            <button
              type="button"
              onClick={() => setConfigToggled(!configOpen)}
              aria-expanded={configOpen}
              aria-controls="config-nav"
              title="Configuration"
              className={cn(
                "mt-6 flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase transition-colors hover:bg-muted hover:text-foreground",
                view.row,
                view.expanded === false ? "" : "justify-between",
              )}
            >
              <span className={view.label}>Configuration</span>
              <CaretDownIcon
                size={11}
                weight="bold"
                className={cn(
                  "shrink-0 transition-transform",
                  configOpen ? "rotate-0" : "-rotate-90",
                )}
              />
            </button>
            <nav
              id="config-nav"
              hidden={!configOpen}
              className="mt-1 flex flex-col gap-0.5"
            >
              {config.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  active={item.href === activeHref}
                  accent={workspace.active}
                  view={view}
                />
              ))}
            </nav>
          </>
        ) : null}

        {/* Customer names and money do not survive a 68px column, so the rail
            drops the whole rail rather than truncating it to nothing. */}
        {workspace.showPipeline && canView("quotationBuilder") ? (
          <div className={cn("min-w-0 flex-col", view.block)}>
            <div className="mt-6 flex items-center justify-between px-2.5">
              <span className="flex items-center gap-1.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                <ChartLineUpIcon size={12} />
                My Pipeline
              </span>
              <span className="text-[10px] text-muted-foreground">
                {watchlist.length}
              </span>
            </div>

            {/* Scrolls with the nav above it rather than in its own box, so the
              rail is not a second scrollbar inside the first. */}
            <div className="mt-1 flex flex-col gap-0.5">
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
          </div>
        ) : null}
      </div>

      <div className="mt-auto flex flex-col gap-3 pt-6">
        {/* The prompt goes with the feature. Offering "See suggestions" to an
            account without the upsell module is an invitation to a redirect. */}
        {canView(workspace.cta.module) ? (
          <div
            className={cn(
              "flex-col rounded-xl bg-zinc-900 p-3 text-zinc-100 dark:bg-zinc-800",
              view.block,
            )}
          >
            <p className="text-xs font-semibold">{workspace.cta.title}</p>
            <p className="mt-0.5 text-[11px] text-zinc-400">
              {workspace.cta.body}
            </p>
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
        ) : null}

        {/* The avatar stays at every width — it is the sign-out route — and only
            the role caption beside it collapses. */}
        <div
          className={cn(
            "flex items-center gap-2 rounded-lg px-2.5 py-2 ring-1 ring-border",
            view.row,
          )}
          title={roleLabel(role)}
        >
          <UserButton />
          <span className={cn("min-w-0 truncate text-[11px] text-muted-foreground", view.label)}>
            {roleLabel(role)}
          </span>
        </div>
      </div>
    </aside>
  );
}

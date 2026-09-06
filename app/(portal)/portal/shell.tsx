import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { CaretRightIcon, LockSimpleIcon } from "@phosphor-icons/react/dist/ssr";
import { BrandMark } from "@/components/brand-mark";
import { cn } from "@/lib/utils";

/**
 * The frame every portal screen sits in.
 *
 * One shell rather than a header pasted into each page, because the two
 * screens a customer sees — the list and the quotation — used to disagree
 * about where the brand sat, whether there was a way back, and what the page
 * width was. A portal is judged on whether it feels like one place; the shell
 * is what makes it one.
 *
 * Server-safe: no hooks, so both server-rendered pages can use it directly.
 */

export type Crumb = { label: string; href?: string };

export function PortalShell({
  customerName,
  crumbs,
  children,
}: {
  customerName: string;
  crumbs?: Crumb[];
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-muted/40">
      <header className="sticky top-0 z-30 border-b border-border/70 bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Link href="/portal" className="flex min-w-0 items-center gap-3">
            <BrandMark size="md" priority />
            <span className="hidden min-w-0 border-l border-border pl-3 sm:block">
              <span className="block text-xs font-semibold">Customer Portal</span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {customerName}
              </span>
            </span>
          </Link>

          <nav aria-label="Portal" className="ml-4 hidden items-center gap-1 md:flex">
            <Link
              href="/portal"
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            >
              Quotations
            </Link>
            <a
              href="#help"
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              Help
            </a>
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <span className="hidden items-center gap-1 text-[11px] text-muted-foreground sm:flex">
              <LockSimpleIcon size={12} weight="fill" />
              Secure
            </span>
            <UserButton />
          </div>
        </div>
      </header>

      {crumbs && crumbs.length > 0 ? (
        <div className="border-b border-border/60 bg-background/60">
          <nav
            aria-label="Breadcrumb"
            className="mx-auto flex h-9 w-full max-w-6xl items-center gap-1 px-4 text-[11px] text-muted-foreground sm:px-6"
          >
            {crumbs.map((crumb, index) => {
              const last = index === crumbs.length - 1;
              return (
                <span key={`${crumb.label}-${index}`} className="flex items-center gap-1">
                  {index > 0 ? <CaretRightIcon size={10} /> : null}
                  {crumb.href && !last ? (
                    <Link href={crumb.href} className="transition-colors hover:text-foreground">
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className={cn(last && "font-medium text-foreground")}>
                      {crumb.label}
                    </span>
                  )}
                </span>
              );
            })}
          </nav>
        </div>
      ) : null}

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
        {children}
      </main>

      <footer className="border-t border-border/60 bg-background/60">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-4 text-[11px] text-muted-foreground sm:px-6">
          <span>© {new Date().getFullYear()} DealFlow360 · Customer Portal</span>
          <span className="hidden sm:inline">
            Prices in Indian rupees. Every figure on a quotation is exactly what
            your account manager sees.
          </span>
          <a href="#help" className="ml-auto transition-colors hover:text-foreground">
            Need help?
          </a>
        </div>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Building blocks the portal pages share
 * ------------------------------------------------------------------ */

/** A titled card with an optional caption and a right-hand slot. */
export function PortalCard({
  title,
  caption,
  action,
  children,
  className,
  bodyClassName,
  id,
}: {
  title?: string;
  caption?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Body padding is the default; pass "p-0" for a table that bleeds to the edge. */
  bodyClassName?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={cn(
        "overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-foreground/10",
        className,
      )}
    >
      {title ? (
        <header className="flex flex-wrap items-center gap-3 border-b border-border/60 px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">{title}</h2>
            {caption ? (
              <p className="text-[11px] text-muted-foreground">{caption}</p>
            ) : null}
          </div>
          {action}
        </header>
      ) : null}
      <div className={cn("p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

/** One figure in the summary row under a page header. */
export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "positive" | "warning" | "muted";
}) {
  return (
    <div className="rounded-2xl bg-card px-5 py-4 shadow-sm ring-1 ring-foreground/10">
      <p className="text-[11px] tracking-wide text-muted-foreground uppercase">{label}</p>
      <p
        className={cn(
          "mt-1 text-lg font-semibold tracking-tight tabular-nums",
          tone === "positive" && "text-emerald-600 dark:text-emerald-400",
          tone === "warning" && "text-amber-600 dark:text-amber-400",
          tone === "muted" && "text-muted-foreground",
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Status as a pill, in the portal's own vocabulary. */
export function StagePill({
  label,
  tone,
}: {
  label: string;
  tone: "open" | "done" | "closed";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ring-1",
        tone === "open" && "bg-sky-500/10 text-sky-700 ring-sky-500/25 dark:text-sky-400",
        tone === "done" &&
          "bg-emerald-500/10 text-emerald-700 ring-emerald-500/25 dark:text-emerald-400",
        tone === "closed" && "bg-red-500/10 text-red-700 ring-red-500/25 dark:text-red-400",
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          tone === "open" && "bg-sky-500",
          tone === "done" && "bg-emerald-500",
          tone === "closed" && "bg-red-500",
        )}
      />
      {label}
    </span>
  );
}

/** A date the way the portal writes it everywhere: 6 Oct 2026. */
export function portalDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/** Whole days from today to `iso`; negative once it has passed. */
export function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

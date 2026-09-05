import Link from "next/link";
import { ArrowUpRightIcon } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";

/**
 * The dashboard's building blocks. Every workspace page is made of these, so a
 * change here restyles the whole app rather than one screen.
 */

export function Panel({
  className,
  delay,
  ...props
}: React.ComponentProps<"section"> & { delay?: number }) {
  return (
    <section
      className={cn(
        "df-rise-in rounded-xl bg-card p-4 ring-1 ring-foreground/10",
        className,
      )}
      style={
        delay === undefined
          ? props.style
          : ({ ...props.style, "--df-delay": `${delay}ms` } as React.CSSProperties)
      }
      {...props}
    />
  );
}

export function PanelHeader({
  icon: Icon,
  title,
  caption,
  href,
  children,
}: {
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  caption?: string;
  /** Renders the corner "open" arrow. */
  href?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex min-w-0 items-center gap-2">
        {Icon ? <Icon size={16} className="text-muted-foreground" /> : null}
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{title}</h2>
          {caption ? (
            <p className="truncate text-[11px] text-muted-foreground">{caption}</p>
          ) : null}
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {children}
        {href ? (
          <Link
            href={href}
            aria-label={`Open ${title}`}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowUpRightIcon size={14} />
          </Link>
        ) : null}
      </div>
    </div>
  );
}

/** Page title block. Pages own their header because there is no top bar. */
export function PageHeader({
  title,
  caption,
  badge,
  children,
}: {
  title: string;
  caption?: string;
  badge?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h1 className="text-base font-semibold tracking-tight">{title}</h1>
          {badge ? (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {badge}
            </span>
          ) : null}
        </div>
        {caption ? (
          <p className="text-xs text-muted-foreground">{caption}</p>
        ) : null}
      </div>

      {children ? (
        <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
      ) : null}
    </header>
  );
}

export function Notice({
  tone = "warning",
  children,
}: {
  tone?: "warning" | "danger";
  children: React.ReactNode;
}) {
  return (
    <p
      className={cn(
        "rounded-xl p-3 text-xs ring-1",
        tone === "warning"
          ? "bg-amber-500/10 text-amber-700 ring-amber-500/30 dark:text-amber-400"
          : "bg-red-500/10 text-red-700 ring-red-500/30 dark:text-red-400",
      )}
    >
      {children}
    </p>
  );
}

/** Consistent shell for the dashboard's data tables. */
export function DataTable({
  head,
  children,
  minWidth = "40rem",
}: {
  head: React.ReactNode;
  children: React.ReactNode;
  minWidth?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table
        className="w-full border-collapse text-xs"
        style={{ minWidth }}
      >
        <thead>
          <tr className="text-left text-[11px] text-muted-foreground">{head}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Th({ className, ...props }: React.ComponentProps<"th">) {
  return <th className={cn("px-2 py-2 font-medium", className)} {...props} />;
}

export function Td({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("px-2 py-2.5", className)} {...props} />;
}

export function Tr({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      className={cn(
        "border-t border-border/60 transition-colors hover:bg-muted/40",
        className,
      )}
      {...props}
    />
  );
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr className="border-t border-border/60">
      <td colSpan={colSpan} className="px-2 py-8 text-center text-muted-foreground">
        {children}
      </td>
    </tr>
  );
}

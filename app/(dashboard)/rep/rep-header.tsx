"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowsClockwiseIcon,
  BellIcon,
  GearSixIcon,
  KanbanIcon,
  MagnifyingGlassIcon,
  SquaresFourIcon,
  XIcon,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { useRole } from "@/lib/use-role";

/**
 * Spec B1 — Sales Workspace Top Menu
 * Actions: Reload Data, Pipeline Kanban, Go to Backend, Close Workspace
 */
export function RepHeader({
  search,
  onSearchChange,
}: {
  search: string;
  onSearchChange: (value: string) => void;
}) {
  const router = useRouter();
  const { canView } = useRole();
  const [reloading, setReloading] = useState(false);

  function handleReload() {
    setReloading(true);
    router.refresh();
    setTimeout(() => {
      setReloading(false);
    }, 600);
  }

  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex items-center gap-2">
          <SquaresFourIcon size={18} weight="fill" className="text-muted-foreground" />
          <h1 className="text-base font-semibold tracking-tight">Sales Workspace</h1>
        </div>

        <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          Pipeline live
        </span>

        {/* Spec B1 Workspace Actions */}
        <div className="hidden items-center gap-1.5 md:flex pl-2 border-l border-border">
          <button
            type="button"
            onClick={handleReload}
            disabled={reloading}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
            title="Refreshes pricing, stock, and approval data from the backend"
          >
            <ArrowsClockwiseIcon size={13} className={reloading ? "animate-spin" : ""} />
            Reload Data
          </button>

          <Link
            href="/quotations"
            className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
            title="Opens Kanban deal pipeline view"
          >
            <KanbanIcon size={13} />
            Pipeline
          </Link>

          {canView("products") && (
            <Link
              href="/backend/products"
              className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
              title="Opens the configuration and settings screen"
            >
              <GearSixIcon size={13} />
              Go to Back-end
            </Link>
          )}

          <Link
            href="/dashboard"
            className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Ends the current working session view"
          >
            <XIcon size={13} />
            Close Workspace
          </Link>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <label className="relative hidden sm:block">
          <MagnifyingGlassIcon
            size={14}
            className="absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
          />
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search customer or product"
            aria-label="Search quotations"
            className="h-8 w-56 rounded-lg bg-muted/60 pr-3 pl-8 text-xs outline-none ring-1 ring-transparent transition focus-visible:bg-background focus-visible:ring-indigo-500"
          >
          </input>
        </label>

        <Button size="icon-sm" variant="outline" className="rounded-lg" aria-label="Notifications">
          <BellIcon size={15} />
        </Button>
      </div>
    </header>
  );
}

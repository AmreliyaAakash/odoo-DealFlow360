"use client";

import { BellIcon, MagnifyingGlassIcon, SquaresFourIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";

/** Page header: title, live pill, and the global search / actions row. */
export function RepHeader({
  search,
  onSearchChange,
}: {
  search: string;
  onSearchChange: (value: string) => void;
}) {
  return (
    <header className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2">
        <SquaresFourIcon size={18} weight="fill" className="text-muted-foreground" />
        <h1 className="text-base font-semibold tracking-tight">Dashboard</h1>
      </div>

      <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
        <span className="size-1.5 rounded-full bg-emerald-500" />
        Pipeline live
      </span>

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
            className="h-8 w-60 rounded-lg bg-muted/60 pr-3 pl-8 text-xs outline-none ring-1 ring-transparent transition focus-visible:bg-background focus-visible:ring-indigo-500"
          />
        </label>

        <Button size="icon-sm" variant="outline" className="rounded-lg" aria-label="Notifications">
          <BellIcon size={15} />
        </Button>
      </div>
    </header>
  );
}

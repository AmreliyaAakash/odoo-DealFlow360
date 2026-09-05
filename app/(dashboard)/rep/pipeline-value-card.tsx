"use client";

import Link from "next/link";
import { ArrowUpRightIcon, PlusIcon, WalletIcon } from "@phosphor-icons/react";
import { formatCurrency, formatPercent } from "@/lib/quotations";
import { useCountUp } from "@/lib/use-count-up";
import type { PipelineValue } from "./types";

/** The "balance" tile: what the rep's open pipeline is worth right now. */
export function PipelineValueCard({ value }: { value: PipelineValue }) {
  const animated = useCountUp(value.total);

  return (
    <section
      className="df-rise-in rounded-xl bg-card p-4 ring-1 ring-foreground/10"
      style={{ "--df-delay": "320ms" } as React.CSSProperties}
    >
      <div className="flex items-center gap-2">
        <WalletIcon size={16} className="text-muted-foreground" />
        <h2 className="text-sm font-semibold">Pipeline Value</h2>
        <Link
          href="/reports"
          aria-label="Open reports"
          className="ml-auto text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowUpRightIcon size={14} />
        </Link>
      </div>

      <p className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">
        {formatCurrency(animated)}
      </p>

      <dl className="mt-4 grid grid-cols-3 gap-2">
        <Metric label="Margin" value={formatCurrency(value.margin)} />
        <Metric label="Margin %" value={formatPercent(value.marginPct)} />
        <Metric label="Top account" value={value.bestCustomer ?? "—"} />
      </dl>

      <div className="mt-4 flex gap-2">
        <Link
          href="/quotations"
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-50 transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          <PlusIcon size={13} weight="bold" />
          New Quote
        </Link>
        <Link
          href="/reports"
          className="flex flex-1 items-center justify-center rounded-lg bg-muted px-3 py-2 text-xs font-medium transition-colors hover:bg-muted/70"
        >
          Export
        </Link>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] text-muted-foreground">{label}</dt>
      <dd className="truncate text-xs font-medium tabular-nums">{value}</dd>
    </div>
  );
}

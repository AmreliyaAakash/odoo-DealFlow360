"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRightIcon, ChartLineUpIcon } from "@phosphor-icons/react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCompactCurrency, formatCurrency } from "@/lib/quotations";
import { cn } from "@/lib/utils";
import { RANGE_DAYS, type PipelinePoint, type RangeKey } from "./types";

const COUNT_COLOR = "#18181b";
const VALUE_COLOR = "#14b8a6";

const RANGES: RangeKey[] = ["1W", "1M", "3M", "1Y", "ALL"];

export function PipelineChart({ data }: { data: PipelinePoint[] }) {
  const [range, setRange] = useState<RangeKey>("1W");

  const points = useMemo(() => {
    const days = RANGE_DAYS[range];
    return Number.isFinite(days) ? data.slice(-days) : data;
  }, [data, range]);

  // Defensive: a stale payload can hand us points missing these keys.
  const totals = points.reduce(
    (acc, point) => ({
      created: acc.created + Number(point?.created ?? 0),
      value: acc.value + Number(point?.value ?? 0),
    }),
    { created: 0, value: 0 },
  );

  return (
    <section
      className="df-rise-in flex flex-col rounded-xl bg-card p-4 ring-1 ring-foreground/10"
      style={{ "--df-delay": "280ms" } as React.CSSProperties}
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <ChartLineUpIcon size={16} className="text-muted-foreground" />
          <h2 className="text-sm font-semibold">Quotation Pipeline</h2>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/reports"
            className="rounded-lg bg-muted/60 px-2.5 py-1.5 text-[11px] font-medium transition-colors hover:bg-muted"
          >
            More Insight
          </Link>
          <Link
            href="/quotations"
            aria-label="Open quotations"
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowUpRightIcon size={14} />
          </Link>
        </div>
      </div>

      {/* Legend on the left, live totals on the right. */}
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <LegendKey color={COUNT_COLOR} label="Quotes created" />
        <LegendKey color={VALUE_COLOR} label="Quote value" />

        <span className="ml-auto flex items-baseline gap-3 text-xs">
          <span className="font-semibold tabular-nums">{totals.created}</span>
          <span className="font-semibold tabular-nums text-teal-600 dark:text-teal-400">
            {formatCurrency(totals.value)}
          </span>
        </span>
      </div>

      <div className="mt-3 h-60 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -14 }}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="currentColor"
              className="text-border"
              vertical={false}
            />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              fontSize={11}
              minTickGap={24}
              stroke="currentColor"
              className="text-muted-foreground"
            />
            {/* Counts and money differ by orders of magnitude, so each gets its own axis. */}
            <YAxis
              yAxisId="count"
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              fontSize={11}
              width={34}
              stroke="currentColor"
              className="text-muted-foreground"
            />
            <YAxis
              yAxisId="value"
              orientation="right"
              tickLine={false}
              axisLine={false}
              fontSize={11}
              width={48}
              stroke="currentColor"
              className="text-muted-foreground"
              tickFormatter={(value: number) => compact(value)}
            />
            <Tooltip
              cursor={{ stroke: COUNT_COLOR, strokeOpacity: 0.2 }}
              formatter={(value, name) =>
                name === "Quote value"
                  ? [formatCurrency(Number(value ?? 0)), name]
                  : [Number(value ?? 0), String(name ?? "")]
              }
              contentStyle={{
                fontSize: 12,
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: "var(--popover)",
                color: "var(--popover-foreground)",
              }}
            />
            <Line
              yAxisId="count"
              type="monotone"
              dataKey="created"
              name="Quotes created"
              stroke={COUNT_COLOR}
              className="dark:stroke-zinc-100"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              animationDuration={800}
            />
            <Line
              yAxisId="value"
              type="monotone"
              dataKey="value"
              name="Quote value"
              stroke={VALUE_COLOR}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
              animationDuration={800}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-2 flex items-center justify-center gap-1">
        {RANGES.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setRange(key)}
            className={cn(
              "rounded-md px-2.5 py-1 text-[11px] transition-colors",
              range === key
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {key}
          </button>
        ))}
      </div>
    </section>
  );
}

function LegendKey({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <span className="size-2 rounded-[3px]" style={{ background: color }} />
      {label}
    </span>
  );
}

function compact(value: number): string {
  return formatCompactCurrency(value);
}

"use client";

import { TrendUpIcon } from "@phosphor-icons/react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCompactCurrency, formatCurrency } from "@/lib/quotations";
import { Panel, PanelHeader } from "@/components/dashboard/panel";
import type { MrrPoint } from "./types";

const EMERALD = "#10b981";

/** Cumulative MRR at the end of each of the last 8 weeks. */
export function MrrChart({ data }: { data: MrrPoint[] }) {
  const latest = data.at(-1)?.mrr ?? 0;
  const first = data[0]?.mrr ?? 0;
  const growth = first === 0 ? null : (latest - first) / first;

  return (
    <Panel delay={200}>
      <PanelHeader
        icon={TrendUpIcon}
        title="MRR trend"
        caption="Last 8 weeks, cumulative"
        href="/finance/billing"
      />

      <div className="mt-2 flex items-baseline gap-3">
        <p className="text-2xl font-semibold tracking-tight tabular-nums">
          {formatCurrency(latest)}
        </p>
        {growth === null ? null : (
          <span
            className={
              growth >= 0
                ? "rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium tabular-nums text-emerald-600 dark:text-emerald-400"
                : "rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-medium tabular-nums text-red-600 dark:text-red-400"
            }
          >
            {growth >= 0 ? "+" : ""}
            {(growth * 100).toFixed(1)}% over 8 weeks
          </span>
        )}
      </div>

      <div className="mt-3 h-60 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
            <defs>
              <linearGradient id="df-mrr-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={EMERALD} stopOpacity={0.3} />
                <stop offset="100%" stopColor={EMERALD} stopOpacity={0} />
              </linearGradient>
            </defs>

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
              stroke="currentColor"
              className="text-muted-foreground"
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              fontSize={11}
              width={62}
              stroke="currentColor"
              className="text-muted-foreground"
              tickFormatter={(value: number) => formatCompactCurrency(value)}
            />
            <Tooltip
              cursor={{ stroke: EMERALD, strokeOpacity: 0.3 }}
              formatter={(value) => [formatCurrency(Number(value ?? 0)), "MRR"]}
              contentStyle={{
                fontSize: 12,
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: "var(--popover)",
                color: "var(--popover-foreground)",
              }}
            />
            <Area
              type="monotone"
              dataKey="mrr"
              stroke={EMERALD}
              strokeWidth={2}
              fill="url(#df-mrr-fill)"
              dot={{ r: 2.5, fill: EMERALD, strokeWidth: 0 }}
              activeDot={{ r: 4.5 }}
              animationDuration={800}
              animationEasing="ease-out"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}

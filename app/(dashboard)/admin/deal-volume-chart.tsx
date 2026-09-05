"use client";

import { ChartLineUpIcon } from "@phosphor-icons/react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Panel, PanelHeader } from "@/components/dashboard/panel";
import { formatCompactCurrency, formatCurrency, formatNumber } from "@/lib/quotations";
import { VOLUME_WEEKS, type DealVolumePoint } from "./types";

const VIOLET = "#8b5cf6";

/** Net value of quotations raised each week, across every rep. */
export function DealVolumeChart({ data }: { data: DealVolumePoint[] }) {
  const total = data.reduce((sum, point) => sum + point.value, 0);
  const deals = data.reduce((sum, point) => sum + point.count, 0);

  return (
    <Panel delay={200}>
      <PanelHeader
        icon={ChartLineUpIcon}
        title="Deal volume"
        caption={`Company-wide, last ${VOLUME_WEEKS} weeks`}
        href="/reports"
      />

      <div className="mt-2 flex items-baseline gap-3">
        <p className="text-2xl font-semibold tracking-tight tabular-nums">
          {formatCurrency(total)}
        </p>
        <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium tabular-nums text-violet-600 dark:text-violet-400">
          {formatNumber(deals)} quotation{deals === 1 ? "" : "s"}
        </span>
      </div>

      <div className="mt-3 h-60 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
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
              minTickGap={12}
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
              cursor={{ stroke: VIOLET, strokeOpacity: 0.3 }}
              formatter={(value) => [
                formatCurrency(Number(value ?? 0)),
                "Deal volume",
              ]}
              contentStyle={{
                fontSize: 12,
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: "var(--popover)",
                color: "var(--popover-foreground)",
              }}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke={VIOLET}
              strokeWidth={2}
              dot={{ r: 2.5, fill: VIOLET, strokeWidth: 0 }}
              activeDot={{ r: 4.5 }}
              animationDuration={800}
              animationEasing="ease-out"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}

"use client";

import { ChartBarIcon } from "@phosphor-icons/react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Panel, PanelHeader } from "@/components/dashboard/panel";
import type { ApprovalVolumePoint } from "./types";

const SERIES = [
  { key: "approved", label: "Approved", color: "#10b981" },
  { key: "returned", label: "Returned", color: "#f59e0b" },
  { key: "rejected", label: "Rejected", color: "#ef4444" },
] as const;

/** Approval decisions per day, stacked by outcome. */
export function ApprovalVolumeChart({ data }: { data: ApprovalVolumePoint[] }) {
  const total = data.reduce(
    (sum, point) => sum + point.approved + point.returned + point.rejected,
    0,
  );

  return (
    <Panel delay={200}>
      <PanelHeader
        icon={ChartBarIcon}
        title="Approval volume"
        caption={`${total} decision${total === 1 ? "" : "s"} in the last 14 days`}
        href="/approvals"
      />

      <div className="mt-3 h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -22 }}>
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
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              fontSize={11}
              stroke="currentColor"
              className="text-muted-foreground"
            />
            <Tooltip
              cursor={{ fill: "#f59e0b", fillOpacity: 0.08 }}
              contentStyle={{
                fontSize: 12,
                borderRadius: 10,
                border: "1px solid var(--border)",
                background: "var(--popover)",
                color: "var(--popover-foreground)",
              }}
            />
            <Legend
              iconType="circle"
              iconSize={7}
              wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
            />
            {SERIES.map((series, index) => (
              <Bar
                key={series.key}
                dataKey={series.key}
                name={series.label}
                stackId="decisions"
                fill={series.color}
                // Only the top segment gets rounded corners.
                radius={index === SERIES.length - 1 ? [4, 4, 0, 0] : undefined}
                barSize={18}
                animationDuration={700}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}

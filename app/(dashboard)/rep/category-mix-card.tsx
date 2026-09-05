"use client";

import { StackIcon } from "@phosphor-icons/react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCompactCurrency, formatCurrency } from "@/lib/quotations";
import type { CategorySlice } from "./types";

const INDIGO = "#6366f1";

/** Where the open pipeline's value sits by product category. */
export function CategoryMixCard({ slices }: { slices: CategorySlice[] }) {
  return (
    <section
      className="df-rise-in rounded-xl bg-card p-4 ring-1 ring-foreground/10"
      style={{ "--df-delay": "340ms" } as React.CSSProperties}
    >
      <div className="flex items-center gap-2">
        <StackIcon size={16} className="text-muted-foreground" />
        <h2 className="text-sm font-semibold">Value by Category</h2>
      </div>

      {slices.length === 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">
          No active lines to break down.
        </p>
      ) : (
        <div className="mt-3 h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={slices}
              layout="vertical"
              margin={{ top: 4, right: 12, bottom: 0, left: 8 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="currentColor"
                className="text-border"
                horizontal={false}
              />
              <XAxis
                type="number"
                tickLine={false}
                axisLine={false}
                fontSize={11}
                stroke="currentColor"
                className="text-muted-foreground"
                tickFormatter={(value: number) => formatCompactCurrency(value)}
              />
              <YAxis
                type="category"
                dataKey="category"
                tickLine={false}
                axisLine={false}
                fontSize={11}
                width={86}
                stroke="currentColor"
                className="text-muted-foreground"
              />
              <Tooltip
                cursor={{ fill: INDIGO, fillOpacity: 0.08 }}
                formatter={(value) => [formatCurrency(Number(value ?? 0)), "Value"]}
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background: "var(--popover)",
                  color: "var(--popover-foreground)",
                }}
              />
              <Bar
                dataKey="value"
                fill={INDIGO}
                radius={[0, 6, 6, 0]}
                barSize={14}
                animationDuration={800}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

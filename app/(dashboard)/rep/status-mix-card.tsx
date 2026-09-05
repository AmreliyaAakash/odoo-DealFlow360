"use client";

import { ChartPieSliceIcon } from "@phosphor-icons/react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatCurrency } from "@/lib/quotations";
import { statusColor, statusLabel, type StatusSlice } from "./types";

/**
 * Portfolio-style breakdown: a donut of pipeline value by status, over a
 * segmented bar and a per-status list.
 */
export function StatusMixCard({ slices }: { slices: StatusSlice[] }) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const totalCount = slices.reduce((sum, slice) => sum + slice.count, 0);

  return (
    <section
      className="df-rise-in rounded-xl bg-card p-4 ring-1 ring-foreground/10"
      style={{ "--df-delay": "380ms" } as React.CSSProperties}
    >
      <div className="flex items-center gap-2">
        <ChartPieSliceIcon size={16} className="text-muted-foreground" />
        <h2 className="text-sm font-semibold">Pipeline by Status</h2>
        <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium tabular-nums">
          {totalCount} quotes
        </span>
      </div>

      {slices.length === 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">No quotations yet.</p>
      ) : (
        <>
          <div className="mt-2 h-36 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={slices}
                  dataKey="value"
                  nameKey="status"
                  innerRadius={40}
                  outerRadius={62}
                  paddingAngle={2}
                  stroke="none"
                  animationDuration={800}
                >
                  {slices.map((slice) => (
                    <Cell key={slice.status} fill={statusColor(slice.status)} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value, name) => [
                    formatCurrency(Number(value ?? 0)),
                    statusLabel(String(name ?? "")),
                  ]}
                  contentStyle={{
                    fontSize: 12,
                    borderRadius: 10,
                    border: "1px solid var(--border)",
                    background: "var(--popover)",
                    color: "var(--popover-foreground)",
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Segmented bar — the same proportions read left to right. */}
          <div className="mt-1 flex h-1.5 gap-0.5 overflow-hidden rounded-full">
            {slices.map((slice) => (
              <span
                key={slice.status}
                className="h-full"
                style={{
                  background: statusColor(slice.status),
                  width: total === 0 ? 0 : `${(slice.value / total) * 100}%`,
                }}
              />
            ))}
          </div>

          <ul className="mt-3 flex flex-col gap-1.5">
            {slices.map((slice) => (
              <li key={slice.status} className="flex items-center gap-2">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: statusColor(slice.status) }}
                />
                <span className="text-xs capitalize">{statusLabel(slice.status)}</span>
                <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                  {slice.count} · {formatCurrency(slice.value)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

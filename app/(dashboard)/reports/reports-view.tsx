"use client";

import { useCallback, useState } from "react";
import {
  ArrowClockwiseIcon,
  ChartBarIcon,
  FilePdfIcon,
  FileXlsIcon,
  FunnelSimpleIcon,
} from "@phosphor-icons/react";
import type { ReportResult } from "@/app/api/reports/query";
import type { ReportFilters, ReportRow, ReportTotals } from "@/app/api/reports/route";
import type { Scope } from "@/lib/permissions";
import { formatCurrency, formatNumber } from "@/lib/quotations";
import { cn } from "@/lib/utils";
import {
  DataTable,
  EmptyRow,
  Notice,
  Panel,
  PanelHeader,
  Td,
  Th,
  Tr,
} from "@/components/dashboard/panel";
import { StatusBadge } from "@/components/dashboard/status-badge";
import type { Option, ReportOptions } from "./options";

const EMPTY_FILTERS: ReportFilters = {
  period: "last90",
  repId: null,
  status: null,
  product: null,
};

const EMPTY_TOTALS: ReportTotals = {
  count: 0,
  subtotal: 0,
  discountTotal: 0,
  netTotal: 0,
  costTotal: 0,
  marginTotal: 0,
  marginPct: null,
};

/**
 * The report screen.
 *
 * The filters build one query string, and everything downstream uses it: the
 * table fetches it as JSON, and both exports hit the same endpoint with a format
 * on the end. That is what keeps an export identical to what is on screen — not
 * a promise in a comment, but the same URL.
 */
export function ReportsView({
  options,
  scope,
  initial,
}: {
  options: ReportOptions;
  scope: Scope;
  /** The server ran the default filters already; start from that. */
  initial: ReportResult;
}) {
  const [filters, setFilters] = useState<ReportFilters>(EMPTY_FILTERS);
  const [rows, setRows] = useState<ReportRow[]>(initial.rows);
  const [totals, setTotals] = useState<ReportTotals>(initial.totals);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initial.error ?? null);

  const queryString = useCallback(
    (format?: "xlsx" | "html") => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) {
        if (value) params.set(key, String(value));
      }
      if (format) params.set("format", format);
      return params.toString();
    },
    [filters],
  );

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/reports?${queryString()}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error ?? "Could not generate the report");

      setRows(body.rows ?? []);
      setTotals(body.totals ?? EMPTY_TOTALS);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not generate the report");
      setRows([]);
      setTotals(EMPTY_TOTALS);
    } finally {
      setLoading(false);
    }
  }, [queryString]);

  function set(key: keyof ReportFilters, value: string) {
    setFilters((current) => ({ ...current, [key]: value || null }));
  }

  /** XLS downloads; the print view opens a tab the browser turns into a PDF. */
  function exportAs(format: "xlsx" | "html") {
    const url = `/api/reports?${queryString(format)}`;

    if (format === "html") {
      window.open(url, "_blank", "noopener");
      return;
    }

    // A synthetic anchor rather than assigning location: the response is an
    // attachment, so the page must not be treated as navigating away.
    const link = document.createElement("a");
    link.href = url;
    link.download = "";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  const busy = loading;
  const nothing = !loading && rows.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <PanelHeader
          icon={FunnelSimpleIcon}
          title="Filters"
          caption={
            scope === "own"
              ? "Scoped to your own quotations"
              : "Narrow the result set, then export exactly what you see"
          }
        />

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <Select
            label="Period"
            value={filters.period ?? "all"}
            options={options.periods}
            onChange={(value) => set("period", value)}
          />

          {options.canChooseRep ? (
            <Select
              label="Rep"
              value={filters.repId ?? ""}
              options={options.reps}
              placeholder="All reps"
              onChange={(value) => set("repId", value)}
            />
          ) : null}

          <Select
            label="Status"
            value={filters.status ?? ""}
            options={options.statuses}
            placeholder="All statuses"
            onChange={(value) => set("status", value)}
          />

          <Select
            label="Product"
            value={filters.product ?? ""}
            options={options.products}
            placeholder="All products"
            onChange={(value) => set("product", value)}
          />

          <button
            type="button"
            onClick={() => void run()}
            disabled={busy}
            className="flex h-8 items-center gap-1.5 rounded-lg bg-zinc-900 px-3 text-xs font-medium text-zinc-50 transition-colors hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            <ArrowClockwiseIcon size={13} className={busy ? "animate-spin" : ""} />
            {busy ? "Generating" : "Generate report"}
          </button>

          <span className="ml-auto flex gap-2">
            <ExportButton
              icon={FileXlsIcon}
              label="Export XLS"
              disabled={busy || rows.length === 0}
              onClick={() => exportAs("xlsx")}
            />
            <ExportButton
              icon={FilePdfIcon}
              label="Export PDF"
              disabled={busy || rows.length === 0}
              onClick={() => exportAs("html")}
            />
          </span>
        </div>

        {filters.period === "all" && rows.length > 500 ? (
          <p className="mt-3 text-[11px] text-muted-foreground">
            Large result set — narrowing the period will make the export quicker.
          </p>
        ) : null}
      </Panel>

      {error ? <Notice tone="danger">{error}</Notice> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Quotations" value={formatNumber(totals.count)} />
        <Stat label="Net value" value={formatCurrency(totals.netTotal)} />
        <Stat label="Discount given" value={formatCurrency(totals.discountTotal)} />
        <Stat
          label="Blended margin"
          value={
            totals.marginPct === null ? "—" : `${(totals.marginPct * 100).toFixed(1)}%`
          }
          tone={
            totals.marginPct !== null && totals.marginPct < 0.15 ? "warn" : undefined
          }
        />
      </div>

      <Panel delay={80}>
        <PanelHeader
          icon={ChartBarIcon}
          title="Results"
          caption={
            busy
              ? "Generating…"
              : `${formatNumber(rows.length)} row${rows.length === 1 ? "" : "s"} · ${formatCurrency(totals.netTotal)}`
          }
        />

        <div className="mt-3">
          <DataTable
            minWidth="56rem"
            head={
              <>
                <Th>Quotation</Th>
                <Th>Customer</Th>
                <Th>Rep</Th>
                <Th className="w-32">Status</Th>
                <Th className="w-20 text-right">Disc.</Th>
                <Th className="w-28 text-right">Net</Th>
                <Th className="w-28 text-right">Margin</Th>
                <Th className="w-20 text-right">Margin %</Th>
              </>
            }
          >
            {rows.map((row, index) => (
              <Tr
                key={row.quotationId}
                className="df-rise-in"
                // The stagger is capped: on 500 rows a per-row delay would take
                // the best part of a minute to finish.
                style={
                  { "--df-delay": `${Math.min(index, 20) * 30}ms` } as React.CSSProperties
                }
              >
                <Td className="font-medium">
                  {row.reference ?? row.quotationId.slice(0, 8)}
                </Td>
                <Td>{row.customer ?? "—"}</Td>
                <Td className="text-muted-foreground">{row.rep ?? "—"}</Td>
                <Td>
                  <StatusBadge status={row.status ?? "draft"} />
                </Td>
                <Td className="text-right tabular-nums text-muted-foreground">
                  {row.maxDiscountPct.toFixed(0)}%
                </Td>
                <Td className="text-right font-medium tabular-nums">
                  {formatCurrency(row.netTotal)}
                </Td>
                <Td className="text-right tabular-nums text-muted-foreground">
                  {formatCurrency(row.marginTotal)}
                </Td>
                <Td
                  className={cn(
                    "text-right tabular-nums",
                    row.marginPct !== null && row.marginPct < 0
                      ? "font-medium text-red-600 dark:text-red-400"
                      : row.marginPct !== null && row.marginPct < 0.15
                        ? "text-amber-600 dark:text-amber-400"
                        : "",
                  )}
                >
                  {row.marginPct === null
                    ? "—"
                    : `${(row.marginPct * 100).toFixed(1)}%`}
                </Td>
              </Tr>
            ))}

            {nothing ? (
              <EmptyRow colSpan={8}>
                No quotations match these filters.
              </EmptyRow>
            ) : null}
          </DataTable>
        </div>
      </Panel>
    </div>
  );
}

function Select({
  label,
  value,
  options,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  options: Option[];
  /** Rendered as the empty choice; omit for a filter that is always set. */
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-44 rounded-lg bg-muted/60 px-2 text-xs outline-none ring-1 ring-transparent transition focus-visible:bg-background focus-visible:ring-indigo-500"
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function ExportButton({
  icon: Icon,
  label,
  disabled,
  onClick,
}: {
  icon: typeof FileXlsIcon;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-8 items-center gap-1.5 rounded-lg bg-muted px-3 text-xs font-medium transition-colors hover:bg-muted/70 disabled:opacity-50"
    >
      <Icon size={14} />
      {label}
    </button>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn";
}) {
  return (
    <article className="df-rise-in rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <p className="text-[11px] tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <p
        className={cn(
          "mt-2 text-xl font-semibold tracking-tight tabular-nums",
          tone === "warn" && "text-amber-600 dark:text-amber-400",
        )}
      >
        {value}
      </p>
    </article>
  );
}

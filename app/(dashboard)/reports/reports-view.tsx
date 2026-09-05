"use client";

import { useState } from "react";
import {
  ChartBarIcon,
  FilePdfIcon,
  FileXlsIcon,
  FunnelSimpleIcon,
} from "@phosphor-icons/react";
import type { ReportFilters, ReportRow } from "@/app/api/reports/route";
import { formatCurrency } from "@/lib/quotations";
import { exportReportToPdf, exportReportToXls } from "@/lib/report-export";
import {
  DataTable,
  EmptyRow,
  Panel,
  PanelHeader,
  Td,
  Th,
  Tr,
} from "@/components/dashboard/panel";
import { StatusBadge } from "@/components/dashboard/status-badge";

const EMPTY_FILTERS: ReportFilters = {
  period: null,
  repId: null,
  status: null,
  product: null,
};

const FILTERS: { key: keyof ReportFilters; label: string; placeholder: string }[] = [
  { key: "period", label: "Period", placeholder: "2026-09" },
  { key: "repId", label: "Rep", placeholder: "user_2abc…" },
  { key: "status", label: "Status", placeholder: "approved" },
  { key: "product", label: "Product", placeholder: "SRV-R450" },
];

export function ReportsView() {
  const [filters, setFilters] = useState<ReportFilters>(EMPTY_FILTERS);
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      for (const { key } of FILTERS) {
        const value = filters[key];
        if (value) params.set(key, value);
      }

      const response = await fetch(`/api/reports?${params}`);
      const body = await response.json();
      setRows(body.rows ?? []);
    } finally {
      setLoading(false);
    }
  }

  const totalNet = rows.reduce((sum, row) => sum + row.netTotal, 0);

  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <PanelHeader icon={FunnelSimpleIcon} title="Filters" caption="Narrow the result set" />

        <div className="mt-3 flex flex-wrap items-end gap-3">
          {FILTERS.map(({ key, label, placeholder }) => (
            <label key={key} className="flex flex-col gap-1">
              <span className="text-[11px] text-muted-foreground">{label}</span>
              <input
                value={filters[key] ?? ""}
                placeholder={placeholder}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    [key]: event.target.value || null,
                  }))
                }
                className="h-8 w-40 rounded-lg bg-muted/60 px-2.5 text-xs outline-none ring-1 ring-transparent transition focus-visible:bg-background focus-visible:ring-indigo-500"
              />
            </label>
          ))}

          <button
            type="button"
            onClick={run}
            disabled={loading}
            className="h-8 rounded-lg bg-zinc-900 px-3 text-xs font-medium text-zinc-50 transition-colors hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {loading ? "Running…" : "Run report"}
          </button>

          <ExportButton
            icon={FileXlsIcon}
            label="XLS"
            disabled={rows.length === 0}
            onClick={() => exportReportToXls(rows)}
          />
          <ExportButton
            icon={FilePdfIcon}
            label="PDF"
            disabled={rows.length === 0}
            onClick={() => exportReportToPdf(rows)}
          />
        </div>
      </Panel>

      <Panel delay={80}>
        <PanelHeader
          icon={ChartBarIcon}
          title="Results"
          caption={
            rows.length === 0
              ? "Nothing run yet"
              : `${rows.length} rows · ${formatCurrency(totalNet)}`
          }
        />

        <div className="mt-3">
          <DataTable
            minWidth="46rem"
            head={
              <>
                <Th>Quotation</Th>
                <Th>Customer</Th>
                <Th>Rep</Th>
                <Th className="w-32">Status</Th>
                <Th className="w-28 text-right">Net</Th>
                <Th className="w-24 text-right">Margin</Th>
              </>
            }
          >
            {rows.map((row, index) => (
              <Tr
                key={row.quotationId}
                className="df-rise-in"
                style={{ "--df-delay": `${index * 35}ms` } as React.CSSProperties}
              >
                <Td className="font-medium">{row.reference ?? row.quotationId}</Td>
                <Td>{row.customer ?? "—"}</Td>
                <Td className="text-muted-foreground">{row.rep ?? "—"}</Td>
                <Td>
                  <StatusBadge status={row.status ?? "draft"} />
                </Td>
                <Td className="text-right font-medium tabular-nums">
                  {formatCurrency(row.netTotal)}
                </Td>
                <Td className="text-right tabular-nums">
                  {row.marginPct === null
                    ? "—"
                    : `${(row.marginPct * 100).toFixed(1)}%`}
                </Td>
              </Tr>
            ))}

            {rows.length === 0 ? (
              <EmptyRow colSpan={6}>
                No results. Set filters and run the report.
              </EmptyRow>
            ) : null}
          </DataTable>
        </div>
      </Panel>
    </div>
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

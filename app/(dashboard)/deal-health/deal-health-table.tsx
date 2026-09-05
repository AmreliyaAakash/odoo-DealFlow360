"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BellIcon,
  ChartBarIcon,
  FilePdfIcon,
  FileXlsIcon,
  HeartbeatIcon,
  WarningCircleIcon,
  CheckCircleIcon,
  ClockIcon,
  ShieldCheckIcon,
} from "@phosphor-icons/react";
import {
  daysStalled,
  hasSlippedPromise,
  isDiscountAnomaly,
  isStalled,
  riskScore,
  riskBand,
  type DealHealthQuotation,
} from "@/lib/business-logic";
import type { ApprovalBreakdown } from "@/lib/deal-health-server";
import { formatCurrency, formatNumber } from "@/lib/quotations";
import { cn } from "@/lib/utils";
import { useSupabase } from "@/components/providers/supabase-provider";
import { DataTable, EmptyRow, Panel, PanelHeader, Td, Th, Tr } from "@/components/dashboard/panel";
import { DiscountBadge, StatusBadge } from "@/components/dashboard/status-badge";
import type { Role } from "@/types/globals";

type Alert = "stalled" | "discount_anomaly" | "slipped";

export function DealHealthTable({
  initial,
  baselines,
  approvalBreakdown,
  canAct,
  role,
}: {
  initial: DealHealthQuotation[];
  baselines: Record<string, number>;
  approvalBreakdown: ApprovalBreakdown;
  canAct: boolean;
  role?: Role | null;
}) {
  const supabase = useSupabase();
  const [rows, setRows] = useState(initial);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [chased, setChased] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [bulkPending, setBulkPending] = useState(false);

  useEffect(() => {
    const channel = supabase
      .channel("deal-health-quotations")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "quotations" },
        (payload) => {
          setRows((current) => mergeChange(current, payload));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  // Compute live metrics across all open quotations
  const { stalledDeals, anomalyDeals, slippageDeals, pendingDeals, atRiskList } = useMemo(() => {
    const stalled: DealHealthQuotation[] = [];
    const anomalies: DealHealthQuotation[] = [];
    const slippages: DealHealthQuotation[] = [];
    const pendings: DealHealthQuotation[] = [];

    const atRisk: {
      quotation: DealHealthQuotation;
      name: string;
      reason: string;
      badgeText: string;
      badgeTone: "amber" | "red" | "orange";
      alertType: Alert;
    }[] = [];

    for (const row of rows) {
      const baseline = row.rep_id ? baselines[row.rep_id] : undefined;
      const isStall = isStalled(row);
      const isAnom = isDiscountAnomaly(row, baseline);
      const isSlip = hasSlippedPromise(row);
      const idle = daysStalled(row);
      const customerName = row.customer?.name ?? row.customer_name ?? row.reference ?? "Quotation";

      if (isStall) stalled.push(row);
      if (isAnom) anomalies.push(row);
      if (isSlip) slippages.push(row);
      if (row.status === "pending_approval") pendings.push(row);

      if (isAnom) {
        const disc = Math.round(Number(row.max_discount_pct ?? 0));
        const base = baseline ? Math.round(baseline) : 10;
        atRisk.push({
          quotation: row,
          name: customerName,
          reason: `${disc}% disc vs ${base}% avg`,
          badgeText: "Anomaly",
          badgeTone: "red",
          alertType: "discount_anomaly",
        });
      } else if (isSlip) {
        atRisk.push({
          quotation: row,
          name: customerName,
          reason: "Ship promise slipped",
          badgeText: "Slipping",
          badgeTone: "red",
          alertType: "slipped",
        });
      } else if (isStall) {
        atRisk.push({
          quotation: row,
          name: customerName,
          reason: idle !== null ? `Inactive ${idle} days` : "Inactive",
          badgeText: "Stalled",
          badgeTone: "amber",
          alertType: "stalled",
        });
      } else if (Number(row.max_discount_pct ?? 0) > 20) {
        atRisk.push({
          quotation: row,
          name: customerName,
          reason: `High discount (${row.max_discount_pct}%)`,
          badgeText: "High risk",
          badgeTone: "amber",
          alertType: "discount_anomaly",
        });
      }
    }

    return {
      stalledDeals: stalled,
      anomalyDeals: anomalies,
      slippageDeals: slippages,
      pendingDeals: pendings,
      atRiskList: atRisk.slice(0, 6),
    };
  }, [rows, baselines]);

  async function raise(quotationId: string, alert: Alert, action: "nudge" | "escalate") {
    setPending(quotationId);
    try {
      const response = await fetch("/api/deal-health/nudge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quotationId, alert, action }),
      });

      setChased((current) => ({
        ...current,
        [quotationId]: response.ok ? (action === "escalate" ? "Escalated" : "Nudged") : "Failed",
      }));
    } catch {
      setChased((current) => ({ ...current, [quotationId]: "Failed" }));
    } finally {
      setPending(null);
    }
  }

  async function handleEscalateSelected() {
    if (selectedIds.size === 0 || bulkPending) return;
    setBulkPending(true);

    for (const item of atRiskList) {
      if (selectedIds.has(item.quotation.id)) {
        await raise(item.quotation.id, item.alertType, "escalate");
      }
    }

    setSelectedIds(new Set());
    setBulkPending(false);
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleExport(format: "pdf" | "xls") {
    const url = `/api/reports?period=last90&format=${format === "pdf" ? "html" : "xlsx"}`;
    window.open(url, "_blank");
  }

  return (
    <div className="flex flex-col gap-5">
      {/* 1. Header with Title & PDF / XLS Export Buttons */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400">
            <HeartbeatIcon size={20} weight="bold" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-foreground">
              Deal health and reporting dashboard
            </h1>
            <p className="text-xs text-muted-foreground">
              Live monitoring of stalled deals, discount anomalies, delivery slippage, and approvals
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => handleExport("pdf")}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground shadow-xs transition-colors hover:bg-muted"
          >
            <FilePdfIcon size={15} className="text-red-500" />
            PDF
          </button>
          <button
            type="button"
            onClick={() => handleExport("xls")}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground shadow-xs transition-colors hover:bg-muted"
          >
            <FileXlsIcon size={15} className="text-emerald-500" />
            XLS
          </button>
        </div>
      </div>

      {/* 2. Top 4 Summary KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
          <p className="text-xs font-medium text-muted-foreground">Stalled deals</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400 tabular-nums">
            {stalledDeals.length}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
          <p className="text-xs font-medium text-muted-foreground">Discount anomalies</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-red-600 dark:text-red-400 tabular-nums">
            {anomalyDeals.length}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
          <p className="text-xs font-medium text-muted-foreground">Pending approvals</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-indigo-600 dark:text-indigo-400 tabular-nums">
            {approvalBreakdown.pending > 0 ? approvalBreakdown.pending : pendingDeals.length}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
          <p className="text-xs font-medium text-muted-foreground">Delivery slippage</p>
          <p className="mt-1 text-2xl font-bold tracking-tight text-rose-600 dark:text-rose-400 tabular-nums">
            {slippageDeals.length}
          </p>
        </div>
      </div>

      {/* 3. 2-Column Split: Stalled/At-Risk Deals & Approval Status Breakdown */}
      <div className="grid gap-4 lg:grid-cols-12">
        {/* Left Column (7 cols): Stalled and at-risk deals */}
        <div className="flex flex-col rounded-xl border border-border bg-card p-4 shadow-xs lg:col-span-7">
          <div className="flex items-center justify-between pb-3 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">Stalled and at-risk deals</h2>
            <span className="text-xs text-muted-foreground">{atRiskList.length} flagged</span>
          </div>

          <div className="divide-y divide-border">
            {atRiskList.map(({ quotation, name, reason, badgeText, badgeTone, alertType }) => {
              const isSelected = selectedIds.has(quotation.id);
              return (
                <div
                  key={quotation.id}
                  className="flex items-center justify-between gap-3 py-2.5 transition-colors hover:bg-muted/30"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(quotation.id)}
                      className="size-3.5 rounded border-muted-foreground/40 text-indigo-600 focus:ring-indigo-500"
                    />
                    <Link
                      href={`/quotations/${quotation.id}`}
                      className="truncate text-xs font-medium text-foreground hover:underline hover:text-indigo-600 dark:hover:text-indigo-400"
                    >
                      <span className="font-semibold">{name}</span>
                      <span className="mx-1 text-muted-foreground">·</span>
                      <span className="text-muted-foreground">{reason}</span>
                    </Link>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Flag tone={badgeTone}>{badgeText}</Flag>
                    {canAct && (
                      <button
                        type="button"
                        disabled={pending === quotation.id}
                        onClick={() => void raise(quotation.id, alertType, "escalate")}
                        className="rounded-md border border-border bg-card px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-muted disabled:opacity-50"
                      >
                        {chased[quotation.id] ?? "Escalate"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {atRiskList.length === 0 && (
              <p className="py-6 text-center text-xs text-muted-foreground">
                All open deals are healthy with no anomalies or stalled timelines.
              </p>
            )}
          </div>

          {canAct && atRiskList.length > 0 && (
            <div className="mt-auto pt-3 border-t border-border flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">
                {selectedIds.size} deal{selectedIds.size === 1 ? "" : "s"} selected
              </span>
              <button
                type="button"
                disabled={selectedIds.size === 0 || bulkPending}
                onClick={handleEscalateSelected}
                className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow-xs transition-colors hover:bg-indigo-700 disabled:opacity-50"
              >
                <BellIcon size={14} />
                Escalate selected
              </button>
            </div>
          )}
        </div>

        {/* Right Column (5 cols): Approval status breakdown */}
        <div className="flex flex-col rounded-xl border border-border bg-card p-4 shadow-xs lg:col-span-5">
          <div className="flex items-center justify-between pb-3 border-b border-border">
            <h2 className="text-sm font-semibold text-foreground">Approval status</h2>
            <Link href="/approvals" className="text-xs text-indigo-600 hover:underline dark:text-indigo-400">
              View queue →
            </Link>
          </div>

          <div className="divide-y divide-border text-xs">
            <div className="flex items-center justify-between py-2.5">
              <span className="text-muted-foreground">Pending</span>
              <span className="font-semibold tabular-nums text-foreground">
                {approvalBreakdown.pending > 0 ? approvalBreakdown.pending : pendingDeals.length}
              </span>
            </div>
            <div className="flex items-center justify-between py-2.5">
              <span className="text-muted-foreground">Approved</span>
              <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                {approvalBreakdown.approved}
              </span>
            </div>
            <div className="flex items-center justify-between py-2.5">
              <span className="text-muted-foreground">Rejected</span>
              <span className="font-semibold tabular-nums text-red-600 dark:text-red-400">
                {approvalBreakdown.rejected}
              </span>
            </div>
            <div className="flex items-center justify-between py-2.5">
              <span className="text-muted-foreground">Sales manager only</span>
              <span className="font-semibold tabular-nums text-foreground">
                {approvalBreakdown.managerOnly}
              </span>
            </div>
            <div className="flex items-center justify-between py-2.5">
              <span className="text-muted-foreground">Manager + finance</span>
              <span className="font-semibold tabular-nums text-foreground">
                {approvalBreakdown.managerFinance}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Full Open Deals Live Realtime Table */}
      <Panel delay={80}>
        <PanelHeader
          icon={HeartbeatIcon}
          title="All open deals"
          caption={`${rows.length} open · live updates streaming`}
          href="/quotations"
        />

        <div className="mt-3">
          <DataTable
            minWidth="52rem"
            head={
              <>
                <Th>Quotation</Th>
                <Th className="w-32">Status</Th>
                <Th className="w-24 text-right">Discount</Th>
                <Th className="w-28 text-right">Value</Th>
                <Th className="w-56">Flags</Th>
                <Th className="w-40" />
              </>
            }
          >
            {rows.map((row, index) => {
              const baseline = row.rep_id ? baselines[row.rep_id] : undefined;
              const stalled = isStalled(row);
              const anomalous = isDiscountAnomaly(row, baseline);
              const slipped = hasSlippedPromise(row);
              const idle = daysStalled(row);

              const alert: Alert | null = anomalous
                ? "discount_anomaly"
                : slipped
                  ? "slipped"
                  : stalled
                    ? "stalled"
                    : null;

              return (
                <Tr
                  key={row.id}
                  className="df-rise-in"
                  style={{ "--df-delay": `${index * 30}ms` } as React.CSSProperties}
                >
                  <Td className="font-medium">
                    <Link
                      href={`/quotations/${row.id}`}
                      className="hover:text-indigo-600 dark:hover:text-indigo-400 font-semibold"
                    >
                      {row.customer?.name ?? row.customer_name ?? row.reference ?? row.id}
                    </Link>
                    {row.reference && (
                      <span className="ml-1.5 text-[11px] text-muted-foreground font-mono">
                        ({row.reference})
                      </span>
                    )}
                  </Td>
                  <Td>
                    <StatusBadge status={row.status ?? "draft"} />
                  </Td>
                  <Td className="text-right">
                    <DiscountBadge value={Number(row.max_discount_pct ?? 0)} />
                  </Td>
                  <Td className="text-right font-medium tabular-nums">
                    {formatCurrency(Number(row.net_total ?? 0))}
                  </Td>
                  <Td>
                    <span className="flex flex-wrap gap-1">
                      {stalled ? (
                        <Flag tone="amber">
                          Stalled{idle === null ? "" : ` ${idle}d`}
                        </Flag>
                      ) : null}
                      {anomalous ? (
                        <Flag tone="red">
                          {baseline === undefined
                            ? "Discount anomaly"
                            : `${Math.round(Number(row.max_discount_pct ?? 0) - baseline)}pp over usual`}
                        </Flag>
                      ) : null}
                      {slipped ? <Flag tone="orange">Promise slipped</Flag> : null}
                      {!stalled && !anomalous && !slipped ? (
                        <Flag tone="emerald">Healthy</Flag>
                      ) : null}
                    </span>
                  </Td>
                  <Td>
                    {alert && canAct ? (
                      chased[row.id] ? (
                        <span className="text-[11px] text-muted-foreground">
                          {chased[row.id]}
                        </span>
                      ) : (
                        <span className="flex gap-1">
                          <button
                            type="button"
                            disabled={pending === row.id}
                            onClick={() => void raise(row.id, alert, "nudge")}
                            className="rounded-lg bg-muted px-2 py-1 text-[11px] font-medium transition-colors hover:bg-muted/70 disabled:opacity-50"
                          >
                            Nudge
                          </button>
                          <button
                            type="button"
                            disabled={pending === row.id}
                            onClick={() => void raise(row.id, alert, "escalate")}
                            className="rounded-lg bg-amber-500/15 px-2 py-1 text-[11px] font-medium text-amber-700 transition-colors hover:bg-amber-500/25 disabled:opacity-50 dark:text-amber-400"
                          >
                            Escalate
                          </button>
                        </span>
                      )
                    ) : null}
                  </Td>
                </Tr>
              );
            })}

            {rows.length === 0 ? (
              <EmptyRow colSpan={6}>No open quotations.</EmptyRow>
            ) : null}
          </DataTable>
        </div>
      </Panel>
    </div>
  );
}

function Flag({
  tone,
  children,
}: {
  tone: "amber" | "red" | "orange" | "emerald";
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-medium",
        tone === "amber" && "bg-amber-500/10 text-amber-600 dark:text-amber-400",
        tone === "red" && "bg-red-500/10 text-red-600 dark:text-red-400",
        tone === "orange" && "bg-orange-500/10 text-orange-600 dark:text-orange-400",
        tone === "emerald" && "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
      )}
    >
      {children}
    </span>
  );
}

type Change = {
  eventType: string;
  new: Record<string, unknown>;
  old: Record<string, unknown>;
};

function mergeChange(
  current: DealHealthQuotation[],
  payload: Change,
): DealHealthQuotation[] {
  if (payload.eventType === "DELETE") {
    const id = payload.old?.id as string | undefined;
    return id ? current.filter((row) => row.id !== id) : current;
  }

  const row = payload.new as unknown as DealHealthQuotation | undefined;
  if (!row?.id) return current;

  const index = current.findIndex((existing) => existing.id === row.id);
  if (index === -1) return [row, ...current];

  const next = [...current];
  next[index] = row;
  return next;
}

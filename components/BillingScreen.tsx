"use client";

import { useMemo } from "react";
import {
  ArrowsClockwiseIcon,
  CalendarBlankIcon,
  ReceiptIcon,
} from "@phosphor-icons/react";
import {
  calculateProration,
  isRecurring,
  nextBillingDate,
  type BillingLine,
} from "@/lib/business-logic";
import { formatCurrency } from "@/lib/quotations";
import { cn } from "@/lib/utils";
import {
  DataTable,
  EmptyRow,
  Panel,
  PanelHeader,
  Td,
  Th,
  Tr,
} from "@/components/dashboard/panel";

/** B7 — STRUCTURE ONLY: proration maths is a stub. */

export type QuantityChange = {
  lineId: string;
  previousQty: number;
  nextQty: number;
  changedAt: Date;
};

export function BillingScreen({
  lines,
  periodStart,
  periodEnd,
  changes = [],
}: {
  lines: BillingLine[];
  periodStart: Date;
  periodEnd: Date;
  changes?: QuantityChange[];
}) {
  const oneTime = useMemo(() => lines.filter((line) => !isRecurring(line)), [lines]);
  const recurring = useMemo(() => lines.filter(isRecurring), [lines]);

  const nextBilling = useMemo(() => {
    const dates = recurring
      .map((line) => nextBillingDate(line, periodStart))
      .filter((date): date is Date => date !== null);
    return dates.length === 0
      ? null
      : new Date(Math.min(...dates.map((date) => date.getTime())));
  }, [recurring, periodStart]);

  const recurringTotal = recurring.reduce(
    (sum, line) => sum + line.unitPrice * line.qty,
    0,
  );
  const oneTimeTotal = oneTime.reduce(
    (sum, line) => sum + line.unitPrice * line.qty,
    0,
  );

  const prorations = useMemo(
    () =>
      changes.map((change) => {
        const line = lines.find((candidate) => candidate.id === change.lineId);
        return {
          change,
          line,
          result: line
            ? calculateProration({
                unitPrice: line.unitPrice,
                previousQty: change.previousQty,
                nextQty: change.nextQty,
                periodStart,
                periodEnd,
                changedAt: change.changedAt,
              })
            : null,
        };
      }),
    [changes, lines, periodStart, periodEnd],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryTile
          icon={CalendarBlankIcon}
          label="Next billing date"
          value={
            // TODO(B7): real date once `nextBillingDate()` is implemented.
            nextBilling?.toLocaleDateString("en-IN", {
              day: "numeric",
              month: "short",
              year: "numeric",
            }) ?? "—"
          }
        />
        <SummaryTile
          icon={ArrowsClockwiseIcon}
          label="Recurring this cycle"
          value={formatCurrency(recurringTotal)}
        />
        <SummaryTile
          icon={ReceiptIcon}
          label="One-time charges"
          value={formatCurrency(oneTimeTotal)}
        />
      </div>

      <BillingLineTable title="One-time charges" lines={oneTime} delay={80} />
      <BillingLineTable title="Recurring charges" lines={recurring} delay={140} />

      <Panel delay={200}>
        <PanelHeader
          icon={ArrowsClockwiseIcon}
          title="Mid-cycle changes"
          caption={`${prorations.length} this cycle`}
        />

        <div className="mt-3 flex flex-col gap-1.5 text-xs">
          {prorations.map(({ change, line, result }) => {
            const amount = result?.amount ?? 0;

            return (
              <div
                key={change.lineId}
                className="flex items-center justify-between gap-4 rounded-lg px-2 py-1.5 hover:bg-muted/50"
              >
                <span className="min-w-0 truncate">
                  {line?.name ?? change.lineId}
                  <span className="text-muted-foreground">
                    {" "}
                    {change.previousQty} → {change.nextQty}
                  </span>
                </span>
                <span
                  className={cn(
                    "shrink-0 font-medium tabular-nums",
                    amount > 0 && "text-foreground",
                    amount < 0 && "text-emerald-600 dark:text-emerald-400",
                    amount === 0 && "text-muted-foreground",
                  )}
                >
                  {result ? formatCurrency(amount) : "—"}
                </span>
              </div>
            );
          })}

          {prorations.length === 0 ? (
            <p className="py-6 text-center text-muted-foreground">
              No changes this cycle.
            </p>
          ) : null}
        </div>
      </Panel>
    </div>
  );
}

function SummaryTile({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof ReceiptIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="df-rise-in rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-300">
          <Icon size={15} weight="fill" />
        </span>
        <p className="text-xs font-medium">{label}</p>
      </div>
      <p className="mt-2 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function BillingLineTable({
  title,
  lines,
  delay,
}: {
  title: string;
  lines: BillingLine[];
  delay: number;
}) {
  return (
    <Panel delay={delay}>
      <PanelHeader
        icon={ReceiptIcon}
        title={title}
        caption={`${lines.length} item${lines.length === 1 ? "" : "s"}`}
      />

      <div className="mt-3">
        <DataTable
          minWidth="32rem"
          head={
            <>
              <Th>Item</Th>
              <Th className="w-28">Cadence</Th>
              <Th className="w-20 text-right">Qty</Th>
              <Th className="w-28 text-right">Unit</Th>
              <Th className="w-28 text-right">Total</Th>
            </>
          }
        >
          {lines.map((line) => (
            <Tr key={line.id}>
              <Td className="font-medium">{line.name}</Td>
              <Td>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium capitalize text-muted-foreground">
                  {line.cadence.replace("_", " ")}
                </span>
              </Td>
              <Td className="text-right tabular-nums">{line.qty}</Td>
              <Td className="text-right tabular-nums">
                {formatCurrency(line.unitPrice)}
              </Td>
              <Td className="text-right font-medium tabular-nums">
                {formatCurrency(line.unitPrice * line.qty)}
              </Td>
            </Tr>
          ))}

          {lines.length === 0 ? <EmptyRow colSpan={5}>None.</EmptyRow> : null}
        </DataTable>
      </div>
    </Panel>
  );
}

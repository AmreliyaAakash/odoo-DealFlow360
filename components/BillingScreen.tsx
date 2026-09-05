"use client";

import { useMemo } from "react";
import {
  calculateProration,
  isRecurring,
  nextBillingDate,
  type BillingLine,
} from "@/lib/business-logic";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/** B7 — STRUCTURE ONLY. */

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
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Next billing date</CardTitle>
        </CardHeader>
        <CardContent>
          {/* TODO(B7): format once `nextBillingDate()` is implemented. */}
          <p className="text-sm">{nextBilling?.toDateString() ?? "—"}</p>
        </CardContent>
      </Card>

      <BillingLineTable title="One-time charges" lines={oneTime} />
      <BillingLineTable title="Recurring charges" lines={recurring} />

      <Card>
        <CardHeader>
          <CardTitle>Mid-cycle changes</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 text-sm">
          {prorations.map(({ change, line, result }) => (
            <div key={change.lineId} className="flex justify-between gap-4">
              <span>
                {line?.name ?? change.lineId}: {change.previousQty} → {change.nextQty}
              </span>
              <span className="tabular-nums">{result?.amount ?? "—"}</span>
            </div>
          ))}
          {prorations.length === 0 ? (
            <p className="text-muted-foreground">No changes this cycle.</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function BillingLineTable({ title, lines }: { title: string; lines: BillingLine[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Item</TableHead>
            <TableHead className="w-28">Cadence</TableHead>
            <TableHead className="w-20 text-right">Qty</TableHead>
            <TableHead className="w-28 text-right">Unit</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((line) => (
            <TableRow key={line.id}>
              <TableCell className="font-medium">{line.name}</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {line.cadence}
              </TableCell>
              <TableCell className="text-right tabular-nums">{line.qty}</TableCell>
              <TableCell className="text-right tabular-nums">{line.unitPrice}</TableCell>
            </TableRow>
          ))}
          {lines.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="text-muted-foreground">
                None.
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </section>
  );
}

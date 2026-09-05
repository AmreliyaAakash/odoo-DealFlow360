"use client";

import { useState } from "react";
import { ChatTeardropTextIcon } from "@phosphor-icons/react";
import { motion } from "framer-motion";
import { formatCurrency } from "@/lib/quotations";
import { cn } from "@/lib/utils";
import type { PortalLine } from "./types";
import { ProposeChangeDialog, type Proposal } from "./propose-change-dialog";

/**
 * The priced lines as the customer sees them: no cost, no margin, no internal
 * risk signals — only what they are being asked to pay.
 */
export function LineItems({
  lines,
  subtotal,
  discountTotal,
  netTotal,
  readOnly,
  onProposed,
}: {
  lines: PortalLine[];
  subtotal: number;
  discountTotal: number;
  netTotal: number;
  /** Closed quotes can still be read, but not negotiated. */
  readOnly: boolean;
  onProposed: (proposal: Proposal) => Promise<void>;
}) {
  const [editing, setEditing] = useState<PortalLine | null>(null);

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs" style={{ minWidth: "36rem" }}>
          <thead>
            <tr className="text-left text-[11px] text-muted-foreground">
              <th className="px-3 py-2 font-medium">Item</th>
              <th className="w-20 px-3 py-2 text-right font-medium">Qty</th>
              <th className="w-28 px-3 py-2 text-right font-medium">Unit price</th>
              <th className="w-24 px-3 py-2 text-right font-medium">Discount</th>
              <th className="w-32 px-3 py-2 text-right font-medium">Total</th>
              {readOnly ? null : <th className="w-36 px-3 py-2" />}
            </tr>
          </thead>

          <tbody>
            {lines.map((line, index) => (
              <motion.tr
                key={line.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.35,
                  delay: index * 0.05,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className="border-t border-border/60 transition-colors hover:bg-sky-500/5"
              >
                <td className="px-3 py-3">
                  <span className="block font-medium">{line.productName}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {line.category}
                    {line.sku ? ` · ${line.sku}` : ""}
                  </span>
                </td>
                <td className="px-3 py-3 text-right tabular-nums">{line.qty}</td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {formatCurrency(line.unitPrice)}
                </td>
                <td className="px-3 py-3 text-right">
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
                      line.discountPct > 0
                        ? "bg-sky-500/10 text-sky-600 dark:text-sky-400"
                        : "text-muted-foreground",
                    )}
                  >
                    {line.discountPct.toFixed(1)}%
                  </span>
                </td>
                <td className="px-3 py-3 text-right font-medium tabular-nums">
                  {formatCurrency(line.net)}
                </td>

                {readOnly ? null : (
                  <td className="px-3 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setEditing(line)}
                      className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-medium text-sky-600 transition-colors hover:bg-sky-500/10 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none dark:text-sky-400"
                    >
                      <ChatTeardropTextIcon size={13} />
                      Propose Change
                    </button>
                  </td>
                )}
              </motion.tr>
            ))}

            {lines.length === 0 ? (
              <tr className="border-t border-border/60">
                <td
                  colSpan={readOnly ? 5 : 6}
                  className="px-3 py-8 text-center text-muted-foreground"
                >
                  This quotation has no items yet.
                </td>
              </tr>
            ) : null}
          </tbody>

          {lines.length > 0 ? (
            <tfoot>
              <SummaryRow label="Subtotal" value={subtotal} trailing={!readOnly} />
              {discountTotal > 0 ? (
                <SummaryRow
                  label="Discount"
                  value={-discountTotal}
                  trailing={!readOnly}
                  tone="sky"
                />
              ) : null}
              <SummaryRow
                label="Total"
                value={netTotal}
                trailing={!readOnly}
                emphasis
              />
            </tfoot>
          ) : null}
        </table>
      </div>

      <ProposeChangeDialog
        line={editing}
        onClose={() => setEditing(null)}
        onSubmit={onProposed}
      />
    </>
  );
}

/**
 * The four leading columns collapse into the label, the total sits under the
 * Total column, and a trailing cell keeps the action column empty.
 */
function SummaryRow({
  label,
  value,
  trailing,
  emphasis = false,
  tone,
}: {
  label: string;
  value: number;
  /** Render the spare cell under the "Propose Change" column. */
  trailing: boolean;
  emphasis?: boolean;
  tone?: "sky";
}) {
  return (
    <tr className={cn("border-t", emphasis ? "border-border" : "border-border/60")}>
      <td
        colSpan={4}
        className={cn(
          "px-3 py-2 text-right",
          emphasis ? "font-semibold" : "text-muted-foreground",
        )}
      >
        {label}
      </td>
      <td
        className={cn(
          "px-3 py-2 text-right tabular-nums",
          emphasis ? "text-sm font-semibold" : "",
          tone === "sky" ? "text-sky-600 dark:text-sky-400" : "",
        )}
      >
        {formatCurrency(value)}
      </td>
      {trailing ? <td /> : null}
    </tr>
  );
}

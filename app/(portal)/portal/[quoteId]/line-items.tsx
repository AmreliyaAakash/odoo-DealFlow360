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
 *
 * Laid out like the document it will become: a header band, one row per line
 * with the money right-aligned, and a totals block that reads down to the
 * payable figure. The totals are a block rather than table rows so they line up
 * whether or not the action column is present.
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
    <section className="overflow-hidden rounded-2xl bg-card shadow-sm ring-1 ring-foreground/10">
      <header className="flex flex-wrap items-center gap-3 border-b border-border/60 px-5 py-3.5">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Line items</h2>
          <p className="text-[11px] text-muted-foreground">
            {readOnly
              ? "These terms are final."
              : "Propose a change on any line and your account manager will see it immediately."}
          </p>
        </div>
        <span className="text-[11px] text-muted-foreground">
          {lines.length} item{lines.length === 1 ? "" : "s"}
        </span>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs" style={{ minWidth: "40rem" }}>
          <thead>
            <tr className="bg-muted/50 text-left text-[10px] tracking-wider text-muted-foreground uppercase">
              <th className="px-5 py-2.5 font-medium">Item</th>
              <th className="w-16 px-3 py-2.5 text-right font-medium">Qty</th>
              <th className="w-32 px-3 py-2.5 text-right font-medium">Unit price</th>
              <th className="w-24 px-3 py-2.5 text-right font-medium">Discount</th>
              <th className="w-36 px-5 py-2.5 text-right font-medium">Amount</th>
              {readOnly ? null : <th className="w-40 px-5 py-2.5" />}
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
                <td className="px-5 py-3.5">
                  <span className="block font-medium text-foreground">{line.productName}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {line.category}
                    {line.sku ? (
                      <>
                        {" · "}
                        <span className="font-mono">{line.sku}</span>
                      </>
                    ) : null}
                  </span>
                </td>
                <td className="px-3 py-3.5 text-right tabular-nums">{line.qty}</td>
                <td className="px-3 py-3.5 text-right tabular-nums text-muted-foreground">
                  {formatCurrency(line.unitPrice)}
                </td>
                <td className="px-3 py-3.5 text-right">
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
                      line.discountPct > 0
                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                        : "text-muted-foreground",
                    )}
                  >
                    {line.discountPct > 0 ? `${line.discountPct.toFixed(1)}%` : "—"}
                  </span>
                </td>
                <td className="px-5 py-3.5 text-right font-semibold tabular-nums">
                  {formatCurrency(line.net)}
                </td>

                {readOnly ? null : (
                  <td className="px-5 py-3.5 text-right">
                    <button
                      type="button"
                      onClick={() => setEditing(line)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:border-sky-400 hover:bg-sky-500/5 hover:text-sky-700 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:outline-none dark:hover:text-sky-400"
                    >
                      <ChatTeardropTextIcon size={13} />
                      Propose change
                    </button>
                  </td>
                )}
              </motion.tr>
            ))}

            {lines.length === 0 ? (
              <tr className="border-t border-border/60">
                <td
                  colSpan={readOnly ? 5 : 6}
                  className="px-5 py-10 text-center text-muted-foreground"
                >
                  This quotation has no items yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {lines.length > 0 ? (
        <div className="flex justify-end border-t border-border bg-muted/30 px-5 py-4">
          <dl className="w-full max-w-xs text-xs">
            <div className="flex items-center justify-between py-1">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd className="tabular-nums">{formatCurrency(subtotal)}</dd>
            </div>
            {discountTotal > 0 ? (
              <div className="flex items-center justify-between py-1">
                <dt className="text-muted-foreground">Discount</dt>
                <dd className="tabular-nums text-emerald-700 dark:text-emerald-400">
                  − {formatCurrency(discountTotal)}
                </dd>
              </div>
            ) : null}
            <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
              <dt className="text-sm font-semibold">Total payable</dt>
              <dd className="text-base font-semibold tabular-nums">
                {formatCurrency(netTotal)}
              </dd>
            </div>
          </dl>
        </div>
      ) : null}

      <ProposeChangeDialog
        line={editing}
        onClose={() => setEditing(null)}
        onSubmit={onProposed}
      />
    </section>
  );
}

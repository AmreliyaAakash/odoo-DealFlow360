"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { formatCurrency } from "@/lib/quotations";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PortalLine } from "./types";

export type Proposal = {
  line: PortalLine;
  /** The discount the customer is asking for, or null when only commenting. */
  discountPct: number | null;
  comment: string;
};

/**
 * A counter-offer on one line. There is no "proposed changes" table: a proposal
 * is a negotiation message, phrased so it reads sensibly in the rep's thread as
 * well as here. The rep applies it in the builder if they accept it.
 */
export function ProposeChangeDialog({
  line,
  onClose,
  onSubmit,
}: {
  /** The line being negotiated, or null when the dialog is closed. */
  line: PortalLine | null;
  onClose: () => void;
  onSubmit: (proposal: Proposal) => Promise<void>;
}) {
  return (
    <Dialog
      open={line !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="rounded-xl sm:max-w-md">
        {/* Keyed on the line, so opening a different row starts a clean form
            rather than inheriting the previous row's draft. */}
        {line ? (
          <ProposalForm
            key={line.id}
            line={line}
            onClose={onClose}
            onSubmit={onSubmit}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ProposalForm({
  line,
  onClose,
  onSubmit,
}: {
  line: PortalLine;
  onClose: () => void;
  onSubmit: (proposal: Proposal) => Promise<void>;
}) {
  const [discount, setDiscount] = useState(
    line.discountPct > 0 ? String(line.discountPct) : "",
  );
  const [comment, setComment] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = discount.trim() === "" ? null : Number(discount);
  const discountValid =
    parsed === null || (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100);
  // Re-sending the discount it already has is not a proposal, so a bare comment
  // is required in that case.
  const changed = parsed !== null && parsed !== line.discountPct;
  const canSend = discountValid && (changed || comment.trim().length > 0);

  const preview =
    parsed !== null && discountValid
      ? line.unitPrice * line.qty * (1 - parsed / 100)
      : null;

  async function submit() {
    if (!canSend || sending) return;

    setSending(true);
    setError(null);
    try {
      await onSubmit({
        line,
        discountPct: changed ? parsed : null,
        comment: comment.trim(),
      });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send. Try again.");
      setSending(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col gap-4"
    >
      <DialogHeader>
        <DialogTitle>Propose a change</DialogTitle>
        <DialogDescription>
          {line.productName} · {line.qty} × {formatCurrency(line.unitPrice)},
          currently at {line.discountPct.toFixed(1)}% off. Your account manager
          sees this in the negotiation thread.
        </DialogDescription>
      </DialogHeader>

      <label className="flex flex-col gap-1.5">
        <span className="text-[11px] font-medium">
          Counter-discount (%)
          <span className="ml-1 font-normal text-muted-foreground">optional</span>
        </span>
        <input
          type="number"
          min={0}
          max={100}
          step={0.5}
          value={discount}
          autoFocus
          placeholder={line.discountPct.toFixed(1)}
          onChange={(event) => setDiscount(event.target.value)}
          aria-invalid={!discountValid}
          className="h-9 rounded-lg bg-muted/60 px-3 text-xs tabular-nums outline-none ring-1 ring-transparent transition focus-visible:bg-background focus-visible:ring-sky-500 aria-invalid:ring-red-500"
        />
        {!discountValid ? (
          <span className="text-[11px] text-red-600 dark:text-red-400">
            Enter a percentage between 0 and 100.
          </span>
        ) : preview !== null && changed ? (
          <span className="text-[11px] text-muted-foreground">
            This line would come to{" "}
            <span className="font-medium text-sky-600 tabular-nums dark:text-sky-400">
              {formatCurrency(preview)}
            </span>{" "}
            instead of {formatCurrency(line.net)}.
          </span>
        ) : null}
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[11px] font-medium">
          Comment
          <span className="ml-1 font-normal text-muted-foreground">
            {changed ? "optional" : "required"}
          </span>
        </span>
        <textarea
          rows={3}
          value={comment}
          placeholder="Tell your account manager why"
          onChange={(event) => setComment(event.target.value)}
          className="resize-none rounded-lg bg-muted/60 px-3 py-2 text-xs outline-none ring-1 ring-transparent transition focus-visible:bg-background focus-visible:ring-sky-500"
        />
      </label>

      {error ? (
        <p className="rounded-lg bg-red-500/10 p-2 text-[11px] text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}

      <DialogFooter>
        <button
          type="button"
          onClick={onClose}
          disabled={sending}
          className="rounded-lg bg-muted px-3 py-2 text-xs font-medium transition-colors hover:bg-muted/70 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!canSend || sending}
          className="rounded-lg bg-sky-500 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-sky-400 disabled:opacity-50"
        >
          {sending ? "Sending" : "Send proposal"}
        </button>
      </DialogFooter>
    </motion.div>
  );
}

/** Renders a proposal as the message the rep will read in the thread. */
export function proposalToMessage(proposal: Proposal): string {
  const { line, discountPct, comment } = proposal;

  const parts: string[] = [];
  if (discountPct !== null) {
    parts.push(
      `Proposed ${discountPct}% discount on ${line.productName} (currently ${line.discountPct.toFixed(1)}%).`,
    );
  } else {
    parts.push(`Question about ${line.productName}.`);
  }
  if (comment) parts.push(comment);

  return parts.join(" ");
}

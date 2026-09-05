"use client";

import { useRef } from "react";
import { LineItems } from "./line-items";
import { NegotiationThread, type NegotiationHandle } from "./negotiation-thread";
import { proposalToMessage, type Proposal } from "./propose-change-dialog";
import type { PortalQuote } from "./types";

/**
 * Joins the two halves of the page: a proposal raised on a line is posted into
 * the negotiation thread, so both live in one conversation rather than two.
 */
export function QuoteView({ quote }: { quote: PortalQuote }) {
  const thread = useRef<NegotiationHandle>(null);

  async function handleProposal(proposal: Proposal) {
    await thread.current?.send(proposalToMessage(proposal));
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <section className="rounded-2xl bg-card ring-1 ring-foreground/10 lg:col-span-2">
        <header className="border-b border-border/60 p-4">
          <h2 className="text-sm font-semibold">What you are quoted for</h2>
          <p className="text-[11px] text-muted-foreground">
            {quote.closedLost
              ? "This quotation is closed."
              : "Propose a change on any line and your account manager will see it."}
          </p>
        </header>

        <LineItems
          lines={quote.lines}
          subtotal={quote.subtotal}
          discountTotal={quote.discountTotal}
          netTotal={quote.netTotal}
          readOnly={quote.closedLost}
          onProposed={handleProposal}
        />

        {quote.notes ? (
          <p className="border-t border-border/60 p-4 text-[11px] whitespace-pre-wrap text-muted-foreground">
            {quote.notes}
          </p>
        ) : null}
      </section>

      <NegotiationThread
        ref={thread}
        quoteId={quote.id}
        readOnly={quote.closedLost}
      />
    </div>
  );
}

"use client";

import { useRef } from "react";
import { type NegotiationHandle } from "@/components/negotiation/negotiation-thread";
import { ConfirmBar } from "./confirm-bar";
import { LineItems } from "./line-items";
import { SidePanel } from "./side-panel";
import { proposalToMessage, type Proposal } from "./propose-change-dialog";
import type { PortalQuote } from "./types";

/**
 * The body of the quotation page: the decision and the detail on the left, the
 * conversation and the account on the right.
 *
 * Joins the two halves: a proposal raised on a line is posted into the thread,
 * so both live in one conversation rather than two. The right column is sticky
 * on a wide screen so a question about line four gets asked without scrolling
 * back up to find the composer.
 */
export function QuoteView({ quote }: { quote: PortalQuote }) {
  const thread = useRef<NegotiationHandle>(null);

  // Terms stop being negotiable once they are settled, not only once the deal is
  // lost: proposing a change against a quotation the customer already confirmed
  // would promise a conversation nobody is going to have.
  const locked = quote.closedLost || quote.settled;

  async function handleProposal(proposal: Proposal) {
    await thread.current?.send(proposalToMessage(proposal));
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex min-w-0 flex-col gap-6">
        {quote.closedLost ? (
          <p className="rounded-2xl bg-red-500/10 p-4 text-xs text-red-700 ring-1 ring-red-500/25 dark:text-red-400">
            This quotation is closed and can no longer be changed. Speak to your
            account manager if you would like a new one.
          </p>
        ) : (
          <ConfirmBar quote={quote} />
        )}

        <LineItems
          lines={quote.lines}
          subtotal={quote.subtotal}
          discountTotal={quote.discountTotal}
          netTotal={quote.netTotal}
          readOnly={locked}
          onProposed={handleProposal}
        />

        {quote.notes ? (
          <section className="rounded-2xl bg-card shadow-sm ring-1 ring-foreground/10">
            <header className="border-b border-border/60 px-5 py-3.5">
              <h2 className="text-sm font-semibold">Notes from your account manager</h2>
            </header>
            <p className="p-5 text-xs leading-relaxed whitespace-pre-wrap text-foreground">
              {quote.notes}
            </p>
          </section>
        ) : null}
      </div>

      <div className="lg:sticky lg:top-24">
        <SidePanel
          quoteId={quote.id}
          readOnly={locked}
          profile={quote.profile}
          threadRef={thread}
        />
      </div>
    </div>
  );
}

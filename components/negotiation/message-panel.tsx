"use client";

import { useState } from "react";
import {
  CaretDownIcon,
  ChatCircleDotsIcon,
  PaperPlaneTiltIcon,
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { NegotiationThread } from "./negotiation-thread";

/**
 * The customer conversation on the desk side, behind a button.
 *
 * Collapsed by default because most visits to a quotation are not about the
 * conversation — but the count is on the button whether it is open or not, so a
 * rep can see there is something waiting without opening anything. The initial
 * count comes from the server render; once the thread is open it keeps itself
 * current over realtime, which is why the badge stops being authoritative and
 * the panel header is not where the live number lives.
 *
 * Mounted on first open and kept mounted after that, so closing the panel does
 * not throw away a half-typed reply or re-fetch the thread.
 */
export function CustomerMessagePanel({
  quotationId,
  canPost,
  initialCount,
}: {
  quotationId: string;
  canPost: boolean;
  initialCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);

  function toggle() {
    setOpen((current) => !current);
    setEverOpened(true);
  }

  return (
    <section className="rounded-2xl bg-card ring-1 ring-foreground/10">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 p-4 text-left"
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
          <ChatCircleDotsIcon size={15} weight="fill" />
        </span>

        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Customer messages</span>
          <span className="block text-[11px] text-muted-foreground">
            {initialCount === 0
              ? canPost
                ? "Nothing sent yet — open to write to the customer"
                : "Nothing sent yet"
              : `${initialCount} message${initialCount === 1 ? "" : "s"} on this quotation`}
          </span>
        </span>

        {initialCount > 0 ? (
          <span className="rounded-full bg-indigo-500/10 px-2 py-0.5 text-[11px] font-medium text-indigo-600 tabular-nums dark:text-indigo-400">
            {initialCount}
          </span>
        ) : null}

        {canPost ? (
          <span className="hidden items-center gap-1 text-[11px] text-muted-foreground sm:flex">
            <PaperPlaneTiltIcon size={12} />
            Reply
          </span>
        ) : null}

        <CaretDownIcon
          size={14}
          className={cn(
            "shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {everOpened ? (
        <div hidden={!open} className="border-t border-border/60 p-3">
          <NegotiationThread
            quotationId={quotationId}
            viewpoint="staff"
            canPost={canPost}
            className="ring-0"
          />
        </div>
      ) : null}
    </section>
  );
}

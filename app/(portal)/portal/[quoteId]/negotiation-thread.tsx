"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { ChatCircleDotsIcon, PaperPlaneRightIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { NegotiationMessage } from "@/app/api/quotations/[id]/negotiation/route";
import { useIsClient } from "@/lib/use-is-client";
import { cn } from "@/lib/utils";

export type NegotiationHandle = {
  /** Posts a message on behalf of another part of the page. */
  send: (body: string) => Promise<void>;
};

/**
 * The conversation between the customer and their account manager. Messages the
 * customer wrote sit on the right in sky; the rep's replies on the left.
 */
export const NegotiationThread = forwardRef<
  NegotiationHandle,
  { quoteId: string; readOnly: boolean }
>(function NegotiationThread({ quoteId, readOnly }, ref) {
  const reduceMotion = useReducedMotion();

  const [messages, setMessages] = useState<NegotiationMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/quotations/${quoteId}/negotiation`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error ?? "Could not load messages");
        return body;
      })
      .then((body) => {
        if (!cancelled) setMessages(body.messages ?? []);
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : "Could not load messages");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [quoteId]);

  // Keep the newest message in view as the thread grows.
  useEffect(() => {
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages.length]);

  const post = useCallback(
    async (body: string) => {
      const text = body.trim();
      if (!text) return;

      setSending(true);
      setError(null);
      try {
        const response = await fetch(`/api/quotations/${quoteId}/negotiation`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: text }),
        });
        const created = await response.json();

        if (!response.ok) {
          throw new Error(created?.error ?? "Could not send your message");
        }
        if (created?.message) {
          setMessages((current) => [...current, created.message]);
        }
      } finally {
        setSending(false);
      }
    },
    [quoteId],
  );

  // The Propose Change dialog posts through this same thread.
  useImperativeHandle(ref, () => ({ send: post }), [post]);

  async function sendDraft() {
    try {
      await post(draft);
      setDraft("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send");
    }
  }

  return (
    <section className="flex h-full flex-col rounded-2xl bg-card ring-1 ring-foreground/10">
      <header className="flex items-center gap-2 border-b border-border/60 p-4">
        <span className="flex size-7 items-center justify-center rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400">
          <ChatCircleDotsIcon size={15} weight="fill" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Negotiation History</h2>
          <p className="text-[11px] text-muted-foreground">
            {loading
              ? "Loading"
              : `${messages.length} message${messages.length === 1 ? "" : "s"} with your account manager`}
          </p>
        </div>
      </header>

      <div
        ref={scroller}
        className="flex max-h-[26rem] min-h-[12rem] flex-1 flex-col gap-3 overflow-y-auto p-4"
      >
        <AnimatePresence initial={false}>
          {messages.map((message) => (
            <motion.div
              key={message.id}
              layout
              initial={
                reduceMotion ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.96 }
              }
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={
                reduceMotion
                  ? { duration: 0.15 }
                  : // A little overshoot, so a new message lands rather than fades.
                    { type: "spring", stiffness: 420, damping: 22, mass: 0.7 }
              }
              className={cn(
                "flex max-w-[85%] flex-col gap-1",
                message.author_kind === "customer"
                  ? "items-end self-end"
                  : "self-start",
              )}
            >
              <div
                className={cn(
                  "rounded-2xl px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap",
                  message.author_kind === "customer"
                    ? "rounded-br-sm bg-sky-500 text-white"
                    : "rounded-bl-sm bg-muted text-foreground",
                )}
              >
                {message.body}
              </div>
              <span className="px-1 text-[10px] text-muted-foreground">
                {message.author_kind === "customer" ? "You" : "Account manager"}
                {" · "}
                <MessageTime iso={message.created_at} />
              </span>
            </motion.div>
          ))}
        </AnimatePresence>

        {!loading && messages.length === 0 ? (
          <p className="my-auto text-center text-xs text-muted-foreground">
            No messages yet. Ask a question, or propose a change on any line.
          </p>
        ) : null}
      </div>

      {error ? (
        <p className="mx-4 mb-2 rounded-lg bg-red-500/10 p-2 text-[11px] text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}

      {readOnly ? (
        <p className="border-t border-border/60 p-4 text-[11px] text-muted-foreground">
          This quotation is closed, so the conversation is read-only.
        </p>
      ) : (
        <div className="flex items-end gap-2 border-t border-border/60 p-3">
          <textarea
            rows={1}
            value={draft}
            placeholder="Write a message"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends; Shift+Enter starts a new line.
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void sendDraft();
              }
            }}
            className="max-h-24 min-h-9 flex-1 resize-none rounded-xl bg-muted/60 px-3 py-2 text-xs outline-none ring-1 ring-transparent transition focus-visible:bg-background focus-visible:ring-sky-500"
          />
          <button
            type="button"
            onClick={() => void sendDraft()}
            disabled={sending || !draft.trim()}
            aria-label="Send message"
            className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-sky-500 text-white transition-colors hover:bg-sky-400 disabled:opacity-50"
          >
            <PaperPlaneRightIcon size={14} weight="fill" />
          </button>
        </div>
      )}
    </section>
  );
});

/**
 * A timestamp formatted on the server disagrees with the browser's locale and
 * timezone, which React reports as a hydration mismatch — so it is rendered only
 * once the client has taken over.
 */
function MessageTime({ iso }: { iso: string }) {
  const isClient = useIsClient();

  return (
    <time dateTime={iso}>
      {isClient
        ? new Date(iso).toLocaleString("en-IN", {
            day: "numeric",
            month: "short",
            hour: "numeric",
            minute: "2-digit",
          })
        : ""}
    </time>
  );
}

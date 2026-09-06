"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  ChatCircleDotsIcon,
  CheckIcon,
  PaperPlaneRightIcon,
  PencilSimpleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { NegotiationMessage } from "@/app/api/quotations/[id]/negotiation/route";
import { useSupabase } from "@/components/providers/supabase-provider";
import { useIsClient } from "@/lib/use-is-client";
import { cn } from "@/lib/utils";

/**
 * The conversation on one quotation, shared by both sides of it.
 *
 * One component rather than two because a thread that renders differently
 * depending on who is reading is exactly the kind of thing that drifts: the
 * portal would gain a feature the desk never got, or the desk would start
 * showing the customer an internal name. What varies is passed in — the
 * viewpoint, and whether this reader may post — and everything else is the same
 * code rendering the same rows.
 *
 * Live, and permanently so: an insert or an edit from the other side arrives
 * over Supabase realtime and lands in place. There is no delete path anywhere
 * in this file, and none in the database either.
 */

export type NegotiationHandle = {
  /** Posts a message on behalf of another part of the page. */
  send: (body: string) => Promise<void>;
};

export type Viewpoint = "customer" | "staff";

type Props = {
  quotationId: string;
  viewpoint: Viewpoint;
  /**
   * False for a reader — a manager or finance user looking in on a rep's
   * thread. They see everything and write nothing, which is what their
   * permissions already say.
   */
  canPost: boolean;
  /** Shown in place of the composer when the conversation is closed. */
  closedReason?: string;
  className?: string;
};

export const NegotiationThread = forwardRef<NegotiationHandle, Props>(
  function NegotiationThread(
    { quotationId, viewpoint, canPost, closedReason, className },
    ref,
  ) {
    const reduceMotion = useReducedMotion();
    const supabase = useSupabase();

    const [messages, setMessages] = useState<NegotiationMessage[]>([]);
    const [authors, setAuthors] = useState<Record<string, string>>({});
    const [viewerId, setViewerId] = useState<string | null>(null);

    const [draft, setDraft] = useState("");
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    /** The message being amended, and the text as it currently stands. */
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editDraft, setEditDraft] = useState("");
    const [savingEdit, setSavingEdit] = useState(false);

    const scroller = useRef<HTMLDivElement>(null);

    /* ---------------------------------------------------------------- load */

    useEffect(() => {
      let cancelled = false;

      fetch(`/api/quotations/${quotationId}/negotiation`)
        .then(async (response) => {
          const body = await response.json();
          if (!response.ok) throw new Error(body?.error ?? "Could not load messages");
          return body;
        })
        .then((body) => {
          if (cancelled) return;
          setMessages(body.messages ?? []);
          setAuthors(body.authors ?? {});
          setViewerId(body.viewerId ?? null);
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
    }, [quotationId]);

    /* ------------------------------------------------------------ realtime */

    useEffect(() => {
      const channel = supabase
        .channel(`negotiation:${quotationId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "negotiation_messages",
            filter: `quotation_id=eq.${quotationId}`,
          },
          (payload) => {
            const row = payload.new as NegotiationMessage | undefined;
            if (!row?.id) return;

            setMessages((current) => {
              const index = current.findIndex((message) => message.id === row.id);

              // An edit replaces in place; a new message appends. The optimistic
              // copy the sender already added is found by id, so their own
              // message does not arrive twice.
              if (index >= 0) {
                const next = [...current];
                next[index] = row;
                return next;
              }
              return [...current, row];
            });
          },
        )
        .subscribe();

      return () => {
        void supabase.removeChannel(channel);
      };
    }, [supabase, quotationId]);

    /* -------------------------------------------------------------- scroll */

    // Follow the newest message, but not while amending an older one — pulling
    // the view away mid-edit is the bug this condition exists to avoid.
    useEffect(() => {
      if (editingId) return;
      const node = scroller.current;
      if (node) node.scrollTop = node.scrollHeight;
    }, [messages.length, editingId]);

    /* ---------------------------------------------------------------- post */

    const post = useCallback(
      async (body: string) => {
        const text = body.trim();
        if (!text) return;

        setSending(true);
        setError(null);
        try {
          const response = await fetch(`/api/quotations/${quotationId}/negotiation`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ body: text }),
          });
          const created = await response.json();

          if (!response.ok) {
            throw new Error(created?.error ?? "Could not send your message");
          }
          if (created?.message) {
            // Merged by id rather than appended: realtime may have delivered
            // this same row already.
            setMessages((current) =>
              current.some((message) => message.id === created.message.id)
                ? current
                : [...current, created.message],
            );
          }
        } finally {
          setSending(false);
        }
      },
      [quotationId],
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

    /* ---------------------------------------------------------------- edit */

    async function saveEdit() {
      const text = editDraft.trim();
      if (!editingId || !text) return;

      setSavingEdit(true);
      setError(null);
      try {
        const response = await fetch(`/api/quotations/${quotationId}/negotiation`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageId: editingId, body: text }),
        });
        const result = await response.json();

        if (!response.ok) throw new Error(result?.error ?? "Could not save the edit");

        if (result?.message) {
          setMessages((current) =>
            current.map((message) =>
              message.id === result.message.id ? result.message : message,
            ),
          );
        }
        setEditingId(null);
        setEditDraft("");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not save the edit");
      } finally {
        setSavingEdit(false);
      }
    }

    /* -------------------------------------------------------------- render */

    /** Which side a bubble sits on: the reader's own side is the right. */
    const isOwnSide = (message: NegotiationMessage) =>
      viewpoint === "customer"
        ? message.author_kind === "customer"
        : message.author_kind === "rep";

    function labelFor(message: NegotiationMessage): string {
      if (message.author_id === viewerId) return "You";

      if (viewpoint === "customer") {
        return message.author_kind === "customer" ? "You" : "Account manager";
      }
      return message.author_kind === "customer"
        ? "Customer"
        : (authors[message.author_id] ?? "Colleague");
    }

    const accent =
      viewpoint === "customer"
        ? "bg-sky-500 text-white"
        : "bg-indigo-500 text-white";

    return (
      <section
        className={cn(
          "flex h-full min-h-0 flex-col rounded-2xl bg-card ring-1 ring-foreground/10",
          className,
        )}
      >
        <header className="flex items-center gap-2 border-b border-border/60 p-4">
          <span
            className={cn(
              "flex size-7 items-center justify-center rounded-lg",
              viewpoint === "customer"
                ? "bg-sky-500/10 text-sky-600 dark:text-sky-400"
                : "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
            )}
          >
            <ChatCircleDotsIcon size={15} weight="fill" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">
              {viewpoint === "customer" ? "Messages" : "Customer conversation"}
            </h2>
            <p className="truncate text-[11px] text-muted-foreground">
              {loading
                ? "Loading"
                : `${messages.length} message${messages.length === 1 ? "" : "s"}${
                    viewpoint === "customer" ? " with your account manager" : ""
                  }`}
            </p>
          </div>
          {/* Live is worth saying once, quietly: it tells someone waiting on a
              reply that they do not need to refresh. */}
          <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            Live
          </span>
        </header>

        <div
          ref={scroller}
          className="flex max-h-[26rem] min-h-[12rem] flex-1 flex-col gap-3 overflow-y-auto p-4"
        >
          <AnimatePresence initial={false}>
            {messages.map((message) => {
              const own = isOwnSide(message);
              const mine = message.author_id === viewerId;
              const editing = editingId === message.id;

              return (
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
                    "group/message flex max-w-[85%] flex-col gap-1",
                    own ? "items-end self-end" : "self-start",
                  )}
                >
                  {editing ? (
                    <div className="w-full rounded-2xl bg-muted p-2 ring-1 ring-border">
                      <textarea
                        autoFocus
                        rows={3}
                        value={editDraft}
                        onChange={(event) => setEditDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") setEditingId(null);
                          if (event.key === "Enter" && !event.shiftKey) {
                            event.preventDefault();
                            void saveEdit();
                          }
                        }}
                        className="w-full resize-none bg-transparent text-xs leading-relaxed outline-none"
                      />
                      <div className="mt-1 flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-muted-foreground hover:bg-background"
                        >
                          <XIcon size={11} /> Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => void saveEdit()}
                          disabled={savingEdit || !editDraft.trim()}
                          className="flex items-center gap-1 rounded-lg bg-foreground px-2 py-1 text-[11px] text-background disabled:opacity-40"
                        >
                          <CheckIcon size={11} weight="bold" /> Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div
                      className={cn(
                        "rounded-2xl px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap",
                        own
                          ? `rounded-br-sm ${accent}`
                          : "rounded-bl-sm bg-muted text-foreground",
                      )}
                    >
                      {message.body}
                    </div>
                  )}

                  <span className="flex items-center gap-1 px-1 text-[10px] text-muted-foreground">
                    {labelFor(message)}
                    {" · "}
                    <MessageTime iso={message.created_at} />
                    {/* Stated, not hidden: the other side has already read the
                        original, so an unmarked edit would be a lie by omission. */}
                    {message.edited_at ? (
                      <span title={`Edited ${message.edited_at}`}> · edited</span>
                    ) : null}

                    {mine && canPost && !editing ? (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(message.id);
                          setEditDraft(message.body);
                        }}
                        aria-label="Edit this message"
                        className="ml-0.5 rounded p-0.5 opacity-0 transition-opacity group-hover/message:opacity-100 focus-visible:opacity-100 hover:text-foreground"
                      >
                        <PencilSimpleIcon size={11} />
                      </button>
                    ) : null}
                  </span>
                </motion.div>
              );
            })}
          </AnimatePresence>

          {!loading && messages.length === 0 ? (
            <p className="my-auto text-center text-xs text-muted-foreground">
              {viewpoint === "customer"
                ? "No messages yet. Ask a question, or propose a change on any line."
                : "No messages yet on this quotation."}
            </p>
          ) : null}
        </div>

        {error ? (
          <p className="mx-4 mb-2 rounded-lg bg-red-500/10 p-2 text-[11px] text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : null}

        {closedReason ? (
          <p className="border-t border-border/60 p-4 text-[11px] text-muted-foreground">
            {closedReason}
          </p>
        ) : canPost ? (
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
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-xl transition-colors disabled:opacity-50",
                accent,
              )}
            >
              <PaperPlaneRightIcon size={14} weight="fill" />
            </button>
          </div>
        ) : (
          <p className="border-t border-border/60 p-4 text-[11px] text-muted-foreground">
            You can read this conversation. Only the rep who owns the quotation
            and the customer can post to it.
          </p>
        )}
      </section>
    );
  },
);

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

"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowUpIcon,
  CheckCircleIcon,
  MicrophoneIcon,
  SparkleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { quickQuestionsFor } from "@/lib/ai/nav";
import { NOTHING_TO_REPORT, ruleForPath } from "@/lib/ai/proactive";
import type { Trigger } from "@/lib/ai/types";
import { useRole } from "@/lib/use-role";
import { cn } from "@/lib/utils";
import { useSpeechInput } from "./use-speech-input";

/**
 * The assistant panel: a launcher pinned bottom-right and a column above it.
 *
 * Everything shown here is either the user's own words or the server's reply.
 * The quick questions are the one exception, and they come from static config
 * keyed by role rather than from the model — which makes them free, instant,
 * and impossible to leak from one role to another.
 *
 * The panel never decides what may be asked. It posts to /api/assistant and
 * renders what comes back, including refusals.
 */

const MAX_LENGTH = 1000;

type Turn = {
  role: "user" | "model";
  text: string;
  usedTools?: string[];
  failed?: boolean;
  /** A turn the user did not ask for, labelled as such in the transcript. */
  proactive?: boolean;
};

/** Tool ids as a sentence, so the panel can say what it looked at. */
const TOOL_LABELS: Record<string, string> = {
  list_quotations: "quotations",
  get_quotation: "a quotation",
  approval_queue: "the approval queue",
  deal_health: "deal health",
  billing_position: "the billing ledger",
  pipeline_overview: "the pipeline",
  performance_stats: "performance stats",
  search_products: "the catalogue",
  navigate: "navigation",
  my_access: "your access",
  explain_calculation: "how that figure is calculated",
  get_draft_context: "the deal's history",
  approval_risk_context: "the approval's risk context",
  recent_deals_batch: "recent deals",
  prepare_quotation_draft: "the catalogue and pricing",
  permission_audit_log: "the permission audit log",
  deal_pipeline_trace: "the full pipeline",
};

/** One proactive call per path per tab. Survives navigation, not a reload. */
const nudged = new Set<string>();

/**
 * Just enough markdown for what the model actually emits.
 *
 * The prompt asks for short plain prose, and it mostly obliges — but every model
 * reaches for `**bold**` around a figure and `- ` or `* ` for a list sooner or
 * later, and rendering those as literal asterisks looks broken. This handles
 * exactly those two and leaves everything else as text: a full markdown parser
 * for three sentences in a side panel is a dependency and an XSS surface for no
 * benefit. Nothing is set as HTML.
 */
function RichText({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, lineIndex) => {
        const bullet = /^\s*[-*]\s+/.test(line);
        const body = bullet ? line.replace(/^\s*[-*]\s+/, "") : line;

        return (
          <span key={lineIndex} className={cn("block", bullet && "pl-3 -indent-2")}>
            {bullet ? "• " : null}
            {body.split(/(\*\*[^*]+\*\*)/g).map((chunk, chunkIndex) =>
              chunk.startsWith("**") && chunk.endsWith("**") && chunk.length > 4 ? (
                <strong key={chunkIndex} className="font-semibold">
                  {chunk.slice(2, -2)}
                </strong>
              ) : (
                chunk
              ),
            )}
          </span>
        );
      })}
    </>
  );
}

export function AssistantWidget() {
  const { role, loaded, can } = useRole();
  const pathname = usePathname();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  /** A proactive answer arrived while the panel was shut. */
  const [unread, setUnread] = useState(false);

  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  // Follow the conversation down as it grows, including while a reply lands.
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  /** Opening the panel is what marks a nudge as read, so it happens on the click. */
  function toggle() {
    setOpen((current) => {
      if (!current) setUnread(false);
      return !current;
    });
  }

  // Dictation feeds the same composer as the keyboard: a transcript lands in the
  // draft for review rather than being sent, because recognition mangles exactly
  // the things this app is full of — rupee amounts and product names.
  const speech = useSpeechInput((transcript) => {
    setDraft((current) => (current ? `${current} ${transcript}` : transcript));
    input.current?.focus();
  });

  /**
   * The assistant speaking first.
   *
   * Fires once per path per tab, only where a rule exists and the user holds the
   * module behind it, and never opens the panel — see lib/ai/proactive.ts for
   * why those three constraints are the whole feature. `busy` is deliberately
   * not a dependency: a nudge that loses the race with a typed question should
   * be dropped, not queued up to interrupt later.
   */
  useEffect(() => {
    if (!loaded || busy) return;

    const rule = ruleForPath(pathname);
    if (!rule || nudged.has(pathname)) return;
    if (!can(rule.module, rule.minimum)) return;

    nudged.add(pathname);
    void send(rule.prompt, { trigger: rule.trigger, proactive: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, loaded]);

  // Escape closes, from anywhere in the panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function send(
    text: string,
    { trigger = "user_message" as Trigger, proactive = false } = {},
  ) {
    const message = text.trim();
    if (!message || busy) return;

    // The history posted back is what is on screen, minus anything that failed:
    // replaying an error message as conversation only confuses the next turn.
    const history = turns
      .filter((turn) => !turn.failed)
      .map(({ role: turnRole, text: turnText }) => ({ role: turnRole, text: turnText }));

    // A proactive turn's prompt was written by us, not typed by anyone, so it
    // does not go in the transcript — showing it would put words in the user's
    // mouth. Its answer is labelled instead.
    if (!proactive) {
      setTurns((current) => [...current, { role: "user", text: message }]);
      setDraft("");
    }

    setBusy(true);

    try {
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history, currentPath: pathname, trigger }),
      });

      const data = (await response.json()) as {
        reply?: string;
        navigateTo?: string | null;
        usedTools?: string[];
        error?: string;
      };

      if (!response.ok) {
        // An unprompted turn fails quietly. Nobody asked, so nobody should be
        // shown an error about it.
        if (proactive) return;

        setTurns((current) => [
          ...current,
          { role: "model", text: data.error ?? "That did not work.", failed: true },
        ]);
        return;
      }

      const reply = (data.reply ?? "").trim();

      // The model was told to say exactly this when a page needs nothing. No
      // badge, no transcript entry — silence is the correct output.
      if (proactive && (!reply || reply.startsWith(NOTHING_TO_REPORT))) return;

      setTurns((current) => [
        ...current,
        {
          role: "model",
          text: reply,
          usedTools: data.usedTools,
          proactive,
        },
      ]);

      if (proactive) setUnread(true);

      // The server already checked the destination against this user's access;
      // an unapproved path never reaches us as navigateTo.
      if (data.navigateTo) {
        router.push(data.navigateTo);
        setOpen(false);
      }
    } catch {
      if (!proactive) {
        setTurns((current) => [
          ...current,
          { role: "model", text: "I could not reach the server. Try again.", failed: true },
        ]);
      }
    } finally {
      setBusy(false);
    }
  }

  const suggestions = quickQuestionsFor(role);

  return (
    <>
      {open ? (
        <div
          role="dialog"
          aria-label="DealFlow360 Assistant"
          className="fixed right-4 bottom-4 z-50 flex h-[min(34rem,calc(100vh-2rem))] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
        >
          <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
            <SparkleIcon size={15} weight="fill" className="text-indigo-500" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">Assistant</p>
              <p className="truncate text-[11px] text-muted-foreground">
                Reads only what you can see
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close assistant"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <XIcon size={14} />
            </button>
          </header>

          <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
            {turns.length === 0 ? (
              <div className="space-y-3 pt-2">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Ask about your quotations, approvals, deals or billing. I only see
                  what your role already lets you see, and I can open the pages you
                  have access to.
                </p>
                <div className="space-y-1.5">
                  {loaded
                    ? suggestions.map((question) => (
                        <button
                          key={question}
                          type="button"
                          onClick={() => send(question)}
                          className="w-full rounded-lg border border-border px-2.5 py-2 text-left text-xs transition-colors hover:border-indigo-400 hover:bg-muted/60"
                        >
                          {question}
                        </button>
                      ))
                    : null}
                </div>
              </div>
            ) : null}

            {turns.map((turn, index) => (
              <div
                key={index}
                className={cn(
                  "flex flex-col gap-1",
                  turn.role === "user" ? "items-end" : "items-start",
                )}
              >
                <div
                  className={cn(
                    "max-w-[90%] rounded-lg px-2.5 py-2 text-xs leading-relaxed",
                    turn.role === "user"
                      ? "bg-zinc-900 whitespace-pre-wrap text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
                      : turn.failed
                        ? "bg-destructive/10 text-destructive"
                        : "bg-muted text-foreground",
                  )}
                >
                  {turn.role === "user" ? turn.text : <RichText text={turn.text} />}
                </div>

                {turn.proactive ? (
                  <p className="order-first pl-0.5 text-[11px] text-muted-foreground">
                    Noticed on this page
                  </p>
                ) : null}

                {turn.usedTools && turn.usedTools.length > 0 ? (
                  <p className="flex items-center gap-1 pl-0.5 text-[11px] text-muted-foreground">
                    <CheckCircleIcon size={11} weight="fill" />
                    Checked{" "}
                    {turn.usedTools
                      .map((tool) => TOOL_LABELS[tool] ?? tool)
                      .join(", ")}
                  </p>
                ) : null}
              </div>
            ))}

            {busy ? (
              <p className="text-[11px] text-muted-foreground">Looking that up…</p>
            ) : null}

            {speech.error ? (
              <p className="text-[11px] text-destructive">{speech.error}</p>
            ) : null}
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              send(draft);
            }}
            className="flex items-end gap-1.5 border-t border-border p-2"
          >
            <textarea
              ref={input}
              rows={1}
              value={draft}
              maxLength={MAX_LENGTH}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                // Enter sends; Shift+Enter is a newline, as in every other
                // composer somebody has used this week.
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send(draft);
                }
              }}
              placeholder={speech.listening ? "Listening…" : "Ask about your deals…"}
              className="max-h-24 min-h-8 flex-1 resize-none rounded-lg border border-border bg-transparent px-2.5 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus-visible:border-indigo-400"
            />

            {/* Only where the browser actually implements recognition — Firefox
                does not, and a dead microphone button is worse than none. */}
            {speech.supported ? (
              <button
                type="button"
                onClick={() => (speech.listening ? speech.stop() : speech.start())}
                aria-label={speech.listening ? "Stop dictation" : "Dictate"}
                aria-pressed={speech.listening}
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-lg border border-border transition-colors",
                  speech.listening
                    ? "border-red-400 bg-red-500/10 text-red-500"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <MicrophoneIcon size={14} weight={speech.listening ? "fill" : "regular"} />
              </button>
            ) : null}

            <button
              type="submit"
              disabled={busy || !draft.trim()}
              aria-label="Send"
              className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-zinc-50 transition-opacity disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
            >
              <ArrowUpIcon size={14} weight="bold" />
            </button>
          </form>
        </div>
      ) : null}

      <button
        type="button"
        onClick={toggle}
        aria-label={open ? "Close assistant" : "Open assistant"}
        className={cn(
          "fixed right-4 bottom-4 z-40 flex size-11 items-center justify-center rounded-full bg-zinc-900 text-zinc-50 shadow-lg transition-all hover:scale-105 dark:bg-zinc-100 dark:text-zinc-900",
          open && "pointer-events-none opacity-0",
        )}
      >
        <SparkleIcon size={18} weight="fill" />

        {/* The whole of a proactive nudge's presence: a dot. It waits to be
            looked at rather than interrupting what someone is doing. */}
        {unread ? (
          <span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 size-3 rounded-full border-2 border-background bg-indigo-500"
          />
        ) : null}
        {unread ? <span className="sr-only">New note from the assistant</span> : null}
      </button>
    </>
  );
}

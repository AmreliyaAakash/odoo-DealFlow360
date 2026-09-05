"use client";

import { useEffect, useState } from "react";
import type { NegotiationMessage } from "@/app/api/quotations/[id]/negotiation/route";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** B8 — STRUCTURE ONLY. */

export function NegotiationThread({ quoteId }: { quoteId: string }) {
  const [messages, setMessages] = useState<NegotiationMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/quotations/${quoteId}/negotiation`)
      .then((response) => response.json())
      .then((body) => {
        if (!cancelled) setMessages(body.messages ?? []);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [quoteId]);

  async function send() {
    if (!draft.trim()) return;

    setSending(true);
    try {
      const response = await fetch(`/api/quotations/${quoteId}/negotiation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: draft }),
      });
      const created = await response.json();
      if (response.ok && created?.message) {
        setMessages((current) => [...current, created.message]);
        setDraft("");
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">Negotiation</h2>

      <div className="flex flex-col gap-2">
        {messages.map((message) => (
          <div key={message.id} className="border p-2 text-sm">
            <p className="text-xs text-muted-foreground">
              {message.author_kind} · {message.created_at}
            </p>
            <p>{message.body}</p>
          </div>
        ))}
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">No messages yet.</p>
        ) : null}
      </div>

      <div className="flex gap-2">
        <Input
          value={draft}
          placeholder="Ask a question or request a change"
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button onClick={send} disabled={sending || !draft.trim()}>
          Send
        </Button>
      </div>
    </section>
  );
}

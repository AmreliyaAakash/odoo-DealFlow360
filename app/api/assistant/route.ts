import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { MissingApiKeyError } from "@/lib/ai/gemini-agent";
import { MAX_MESSAGE_LENGTH, runAssistantTurn } from "@/lib/ai/service";
import { asTrigger, type ChatMessage } from "@/lib/ai/types";

/**
 * POST /api/assistant — one turn with the in-app assistant.
 *
 * A thin wrapper on purpose: the guard, and then `lib/ai/service.ts`. There is
 * no capability check on the route itself because there is no single module the
 * assistant belongs to — being signed in as staff gets you the panel, and what
 * it can actually see is decided per tool from the same matrix every other
 * route uses. An account with nothing granted gets an assistant that can only
 * tell them so.
 *
 * Customers are refused outright. The widget is mounted in the dashboard shell,
 * which they never load, so this is not reachable through the UI — but `proxy.ts`
 * has no entry for /api/assistant, which means a customer session can post here,
 * and "the UI does not offer it" has never been an access control.
 */

/** In-memory throttle: enough to stop a stuck client burning a free-tier key. */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 15;
const hits = new Map<string, number[]>();

function rateLimited(userId: string): boolean {
  const now = Date.now();
  const recent = (hits.get(userId) ?? []).filter((at) => now - at < WINDOW_MS);
  recent.push(now);
  hits.set(userId, recent);
  return recent.length > MAX_PER_WINDOW;
}

/** Only well-formed prior turns are replayed; anything else is dropped. */
function parseHistory(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const { role, text } = entry as { role?: unknown; text?: unknown };
    if (role !== "user" && role !== "model") return [];
    if (typeof text !== "string" || !text.trim()) return [];
    return [{ role, text: text.slice(0, MAX_MESSAGE_LENGTH) }];
  });
}

export async function POST(request: Request) {
  const { userId, role } = await currentUser();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (role === "customer") {
    return NextResponse.json(
      { error: "The assistant is not available on the customer portal." },
      { status: 403 },
    );
  }

  if (rateLimited(userId)) {
    return NextResponse.json(
      { error: "That is a lot of questions at once — give it a minute." },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request" }, { status: 400 });
  }

  const { message, history, currentPath, trigger } = (body ?? {}) as {
    message?: unknown;
    history?: unknown;
    currentPath?: unknown;
    trigger?: unknown;
  };

  if (typeof message !== "string" || !message.trim()) {
    return NextResponse.json({ error: "Ask me something first." }, { status: 400 });
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json(
      { error: `Keep it under ${MAX_MESSAGE_LENGTH} characters.` },
      { status: 400 },
    );
  }

  try {
    const result = await runAssistantTurn({
      userId,
      // Never read from the body. The role is whatever the session says it is.
      role,
      message: message.trim(),
      history: parseHistory(history),
      currentPath: typeof currentPath === "string" ? currentPath : null,
      // Narrowed to the known set: the trigger only changes how the model opens,
      // but an unrecognised one would land in the prompt verbatim.
      trigger: asTrigger(trigger),
    });

    return NextResponse.json({
      reply: result.finalText,
      navigateTo: result.navigateTo,
      // Which tools ran, not what they returned: the panel shows "checked the
      // approval queue" without a second copy of the data crossing the wire.
      usedTools: [...new Set(result.toolCalls.map((call) => call.tool))],
    });
  } catch (err) {
    if (err instanceof MissingApiKeyError) {
      return NextResponse.json(
        { error: "The assistant is not configured yet — GEMINI_API_KEY is missing." },
        { status: 503 },
      );
    }

    console.error("[POST /api/assistant]", err);
    return NextResponse.json(
      { error: "The assistant hit a problem. Try again." },
      { status: 500 },
    );
  }
}

import "server-only";
import type { AgentTurnResult, ChatMessage, ChatTool, ToolCallRecord, ToolContext } from "./types";

/**
 * The function-calling loop, spoken to Gemini over plain REST.
 *
 * No SDK on purpose: the whole protocol we need is one POST, and a dependency
 * that ships its own transport is a lot of surface for `generateContent`.
 *
 * The loop is deliberately dumb. It hands the model the tools it was given,
 * executes whatever it asks for, feeds the results back, and repeats until the
 * model answers in words or the cap is hit. Every permission decision has
 * already happened by the time we get here — see `service.ts`.
 */

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/** Tried in order; the first that is not rate-limited answers. */
const MODELS = ["gemini-flash-latest", "gemini-flash-lite-latest"];

const MAX_ITERATIONS = 6;
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Only the fields we read are typed. The model's own turn is pushed back into
 * the history as the object we received, so the parts we do not name — the
 * thought signatures the flash models attach to a function call — survive the
 * round trip. Dropping those makes the next turn incoherent.
 */
type GeminiPart = {
  text?: string;
  functionCall?: { id?: string; name?: string; args?: Record<string, unknown> };
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
};

type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };

type GeminiResponse = {
  candidates?: { content?: { parts?: GeminiPart[] } }[];
  error?: { message?: string; status?: string };
};

export class MissingApiKeyError extends Error {}

function apiKey(): string {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) {
    throw new MissingApiKeyError(
      "GEMINI_API_KEY is not set — add it to .env.local and restart the dev server.",
    );
  }
  return key;
}

/**
 * Strips the JSON Schema keywords Gemini's parameter parser rejects outright.
 * A stray `additionalProperties` fails the whole request, not just that field.
 */
function toGeminiSchema(schema: unknown): unknown {
  if (schema === null || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (key === "additionalProperties" || key === "$schema") continue;
    out[key] = toGeminiSchema(value);
  }
  return out;
}

function declarationsFor(tools: ChatTool[]) {
  return tools.map((tool) => {
    const parameters = toGeminiSchema(tool.parameters) as Record<string, unknown>;
    const hasProperties =
      parameters &&
      typeof parameters.properties === "object" &&
      Object.keys(parameters.properties as object).length > 0;

    return {
      name: tool.id,
      description: tool.description,
      // An empty `parameters` object is rejected; omit it for no-argument tools.
      ...(hasProperties ? { parameters } : {}),
    };
  });
}

/**
 * One round trip, walking the model list on quota errors.
 *
 * A 429 on the flash tier is the normal failure on a free key, and the lite
 * tier has its own budget — so a burst of questions degrades to a smaller model
 * rather than to an error message.
 */
async function callGemini(
  body: Record<string, unknown>,
): Promise<{ data: GeminiResponse } | { error: string }> {
  const key = apiKey();
  let lastError = "The AI service did not respond.";

  for (const model of MODELS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${ENDPOINT}/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-goog-api-key": key },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (response.ok) {
        return { data: (await response.json()) as GeminiResponse };
      }

      const detail = (await response.json().catch(() => null)) as GeminiResponse | null;
      const message = detail?.error?.message ?? `HTTP ${response.status}`;

      if (response.status === 429 || response.status >= 500) {
        // Worth another model; a 400 or 403 would fail identically on all of them.
        lastError =
          response.status === 429
            ? "The AI service is rate-limited right now — try again in a minute."
            : "The AI service is temporarily unavailable.";
        continue;
      }

      if (response.status === 401 || response.status === 403) {
        return { error: "The AI service rejected our API key. Check GEMINI_API_KEY." };
      }

      return { error: `The AI service refused the request: ${message}` };
    } catch (err) {
      lastError =
        err instanceof Error && err.name === "AbortError"
          ? "The AI service took too long to answer."
          : "Could not reach the AI service.";
    } finally {
      clearTimeout(timer);
    }
  }

  return { error: lastError };
}

export type RunAgentInput = {
  systemPrompt: string;
  messages: ChatMessage[];
  tools: ChatTool[];
  /** Resolves the per-tool context; the registry owns how scope is derived. */
  contextFor: (tool: ChatTool) => ToolContext;
};

export async function runAgentLoop({
  systemPrompt,
  messages,
  tools,
  contextFor,
}: RunAgentInput): Promise<AgentTurnResult> {
  const functionDeclarations = declarationsFor(tools);
  const byId = new Map(tools.map((tool) => [tool.id, tool]));
  const toolCalls: ToolCallRecord[] = [];
  let navigateTo: string | null = null;

  const contents: GeminiContent[] = messages.map((message) => ({
    role: message.role,
    parts: [{ text: message.text }],
  }));

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const result = await callGemini({
      contents,
      systemInstruction: { parts: [{ text: systemPrompt }] },
      ...(functionDeclarations.length > 0 ? { tools: [{ functionDeclarations }] } : {}),
    });

    if ("error" in result) {
      return { finalText: result.error, toolCalls, navigateTo, error: result.error };
    }

    const parts = result.data.candidates?.[0]?.content?.parts ?? [];
    const calls = parts.flatMap((part) => (part.functionCall ? [part.functionCall] : []));

    if (calls.length === 0) {
      const text = parts
        .map((part) => part.text ?? "")
        .join("")
        .trim();

      return {
        finalText: text || "I don't have an answer for that one.",
        toolCalls,
        navigateTo,
        error: null,
      };
    }

    // The model's own turn goes back into the history before our responses do,
    // or the next round trip sees function results with nothing that asked for
    // them and the conversation stops making sense.
    contents.push({ role: "model", parts });

    const responses: GeminiPart[] = [];

    for (const call of calls) {
      const name = call.name ?? "";
      const args = call.args ?? {};
      // Echoed back on the response so a turn with several calls in flight can
      // be matched up. Absent on a single call, and harmless either way.
      const id = call.id ? { id: call.id } : {};

      // Only tools this caller was actually offered can run. The model is not
      // supposed to invent a name, but "not supposed to" is not an access
      // control — a hallucinated call to a tool they cannot use dies here.
      const tool = byId.get(name);
      if (!tool) {
        const denial = { error: `No tool named "${name}" is available to you.` };
        toolCalls.push({ tool: name, args, result: denial });
        responses.push({ functionResponse: { ...id, name, response: denial } });
        continue;
      }

      try {
        const output = await tool.execute(args, contextFor(tool));
        toolCalls.push({ tool: name, args, result: output });

        // `navigate` reports where it approved; the route push happens in the
        // browser, after the answer is rendered.
        if (name === "navigate") {
          const approved = (output as { path?: string } | null)?.path;
          if (typeof approved === "string") navigateTo = approved;
        }

        responses.push({
          functionResponse: {
            ...id,
            name,
            response: (output ?? {}) as Record<string, unknown>,
          },
        });
      } catch (err) {
        // Fed back as a normal result rather than thrown: the model can tell
        // the user what failed, which beats the whole turn collapsing.
        const message = err instanceof Error ? err.message : "Unknown error";
        const failure = { error: message };
        toolCalls.push({ tool: name, args, result: failure });
        responses.push({ functionResponse: { ...id, name, response: failure } });
      }
    }

    contents.push({ role: "user", parts: responses });
  }

  return {
    finalText:
      "I went back and forth on that too many times without landing on an answer. Try asking it more narrowly.",
    toolCalls,
    navigateTo,
    error: null,
  };
}

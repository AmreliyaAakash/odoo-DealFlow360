import "server-only";
import { clerkClient } from "@clerk/nextjs/server";
import { canWith, effectiveAccess } from "@/lib/permissions-server";
import { ASSISTANT_ROUTES } from "./nav";
import { runAgentLoop } from "./gemini-agent";
import { buildSystemPrompt } from "./system-prompt";
import { contextForTool, getToolsForUser } from "./tool-registry";
import type { AgentTurnResult, ChatMessage, Trigger } from "./types";
import type { Role } from "@/types/globals";

// Side-effect import: fills the registry. See tools/index.ts.
import "./tools";

/**
 * One chat turn, start to finish.
 *
 * The order matters and is the whole security argument: resolve the caller's
 * real access first, derive the tool list and the route list from it, and only
 * then build a prompt and call the model. Nothing the user typed — and nothing
 * the model replies — can widen any of it, because by the time either is read
 * the tool list is already fixed.
 */

/** Keeps a turn bounded; the panel is for questions, not for pasting a document. */
export const MAX_MESSAGE_LENGTH = 1000;

/** How much of the conversation goes back to the model. */
const HISTORY_TURNS = 8;

export type AssistantTurnInput = {
  userId: string;
  role: Role | null;
  message: string;
  /** Prior turns from the client. Untrusted — it only shapes the conversation. */
  history: ChatMessage[];
  currentPath: string | null;
  trigger: Trigger;
};

async function displayNameFor(userId: string): Promise<string> {
  try {
    const user = await (await clerkClient()).users.getUser(userId);
    return (
      [user.firstName, user.lastName].filter(Boolean).join(" ") ||
      user.emailAddresses[0]?.emailAddress ||
      "there"
    );
  } catch {
    // A greeting is not worth failing a turn over.
    return "there";
  }
}

export async function runAssistantTurn({
  userId,
  role,
  message,
  history,
  currentPath,
  trigger,
}: AssistantTurnInput): Promise<AgentTurnResult> {
  const [{ access }, displayName] = await Promise.all([
    effectiveAccess(userId, role),
    displayNameFor(userId),
  ]);

  const tools = getToolsForUser(role, access);

  const routes = ASSISTANT_ROUTES.filter(
    (route) => route.module === null || canWith(access, route.module, route.minimum),
  );

  const systemPrompt = buildSystemPrompt({
    role,
    displayName,
    access,
    routes,
    tools,
    currentPath,
    trigger,
  });

  // The client's history is replayed as conversation, never as instruction: it
  // reaches the model as user/model turns under the system prompt, and it can
  // no more grant a tool than a typed message can.
  const messages: ChatMessage[] = [
    ...history.slice(-HISTORY_TURNS),
    { role: "user", text: message },
  ];

  return runAgentLoop({
    systemPrompt,
    messages,
    tools,
    contextFor: (tool) => contextForTool(tool, userId, role, access),
  });
}

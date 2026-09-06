import type { Capability, Module, Scope } from "@/lib/permissions";
import type { ModuleAccess } from "@/lib/permissions-server";
import type { Role } from "@/types/globals";

/**
 * The AI assistant, as a thin layer over the access matrix.
 *
 * Nothing here decides what a user may see. Every tool names the module it
 * reads and the capability it needs, and the registry filters the tool list
 * against the caller's own `effectiveAccess` before the model is ever told a
 * tool exists — the same matrix `requireCapability` enforces on every API
 * route. The system prompt is a hint to the model; this is the enforcement.
 */

/** Identity handed to every tool. `access` is resolved server-side, never sent by the client. */
export type ToolContext = {
  userId: string;
  role: Role | null;
  access: ModuleAccess;
  /** Row scope for the module the tool declared, resolved by the registry. */
  scope: Scope;
};

/**
 * Why the assistant is running.
 *
 * A page load or an opened approval produces a turn nobody typed, so the model
 * needs to know the difference — an unprompted answer has to lead with the one
 * fact that earned the interruption, where a reply to a question can simply
 * answer it.
 */
export const TRIGGERS = ["user_message", "page_load", "approval_open"] as const;
export type Trigger = (typeof TRIGGERS)[number];

export function asTrigger(value: unknown): Trigger {
  return TRIGGERS.includes(value as Trigger) ? (value as Trigger) : "user_message";
}

export type ChatTool = {
  id: string;
  description: string;
  /**
   * The module this tool reads. `null` means it touches no business data and is
   * available to any signed-in user (e.g. the navigation helper, which does its
   * own per-route check).
   */
  module: Module | null;
  /** Capability the caller needs on `module`. Ignored when `module` is null. */
  minimum: Capability;
  /**
   * Restricted to admins on top of any module check.
   *
   * For the one tool whose subject is the permission system itself: an admin is
   * the only role that hands out access, so the audit trail cannot be governed
   * by a module grant without letting someone read the log that records their
   * own grant being made.
   */
  adminOnly?: boolean;
  /**
   * Appended to the system prompt only when this tool is in the caller's list.
   *
   * Rules about a tool are worthless to someone who cannot call it and cost
   * tokens on every turn, so they travel with the tool rather than living in
   * the base prompt.
   */
  promptNote?: string;
  /** JSON schema for the arguments, in the OpenAPI subset Gemini accepts. */
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
};

export type ChatRole = "user" | "model";

export type ChatMessage = { role: ChatRole; text: string };

export type ToolCallRecord = { tool: string; args: unknown; result: unknown };

export type AgentTurnResult = {
  finalText: string;
  toolCalls: ToolCallRecord[];
  /** Set when the model asked the client to navigate somewhere it may go. */
  navigateTo: string | null;
  error: string | null;
};

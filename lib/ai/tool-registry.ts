import { canWith, scopeWith, type ModuleAccess } from "@/lib/permissions-server";
import type { ChatTool, ToolContext } from "./types";
import type { Role } from "@/types/globals";

/**
 * Tools register themselves at import time; `tools/index.ts` is a barrel that
 * imports every tool module for that side effect alone, and `service.ts`
 * imports the barrel once before handling any request.
 */

const registry = new Map<string, ChatTool>();

export function registerTool(tool: ChatTool): void {
  if (registry.has(tool.id)) {
    throw new Error(`[assistant] duplicate tool id: ${tool.id}`);
  }
  registry.set(tool.id, tool);
}

export function getAllTools(): ChatTool[] {
  return [...registry.values()];
}

export function getTool(id: string): ChatTool | undefined {
  return registry.get(id);
}

/** True when this caller clears every bar the tool declared. */
export function isToolAllowed(
  tool: ChatTool,
  role: Role | null,
  access: ModuleAccess,
): boolean {
  if (tool.adminOnly && role !== "admin") return false;
  return tool.module === null || canWith(access, tool.module, tool.minimum);
}

/** The tools this caller may be told about at all. */
export function getToolsForUser(role: Role | null, access: ModuleAccess): ChatTool[] {
  return getAllTools().filter((tool) => isToolAllowed(tool, role, access));
}

/**
 * The context one tool runs under.
 *
 * `scope` is resolved per tool from the module it named, so a rep asking about
 * quotations gets `own` and a finance user asking about billing gets `all` —
 * from the same matrix, in the same request, without either tool knowing the
 * caller's role.
 */
export function contextForTool(
  tool: ChatTool,
  userId: string,
  role: Role | null,
  access: ModuleAccess,
): ToolContext {
  return {
    userId,
    role,
    access,
    scope: tool.module ? scopeWith(access, tool.module) : "none",
  };
}

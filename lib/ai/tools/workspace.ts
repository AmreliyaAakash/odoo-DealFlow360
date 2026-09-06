import "server-only";
import { MODULE_LABELS, type Access, type Module } from "@/lib/permissions";
import { canWith } from "@/lib/permissions-server";
import { roleLabel } from "@/lib/roles";
import { ASSISTANT_ROUTES } from "../nav";
import { registerTool } from "../tool-registry";
import type { ChatTool } from "../types";

/**
 * The two tools that are about the workspace rather than the business data:
 * where the user may go, and what they may see.
 *
 * `navigate` re-checks the route against the caller's own access instead of
 * trusting the path the model produced. The model is only ever shown routes the
 * user can reach, so a call to a forbidden one means it went off-script — and
 * this is where that stops being interesting.
 */

const navigate: ChatTool = {
  id: "navigate",
  description:
    "Open a page in the app for the user. Only paths listed as reachable in the system " +
    "prompt will be accepted; anything else is refused. Call this when the user asks to go " +
    "somewhere, or when the answer is better read on a screen than summarised.",
  module: null,
  minimum: "view",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "The in-app path, e.g. /approvals." },
      reason: {
        type: "string",
        description: "One short line telling the user what they will find there.",
      },
    },
    required: ["path"],
  },
  execute: async (args, ctx) => {
    const requested = typeof args.path === "string" ? args.path.trim() : "";

    // Must be one of ours and nothing else: a leading "/" that is not "//"
    // rules out absolute and protocol-relative URLs, so this can never become
    // an open redirect off the app.
    if (!requested.startsWith("/") || requested.startsWith("//")) {
      return { error: `"${requested}" is not a page this assistant can open.` };
    }

    if (requested.length > 2000) {
      return { error: "That link is too long to open." };
    }

    // A prepared draft arrives as /quotations/new?customer=…&line=…, so the
    // allow-list is checked against the path and the query rides along. The
    // destination page validates every parameter itself — see
    // app/(dashboard)/quotations/new/page.tsx.
    const [pathname, query] = requested.split("?", 2);
    const route = ASSISTANT_ROUTES.find((candidate) => candidate.path === pathname);

    if (!route) {
      return { error: `"${pathname}" is not a page this assistant can open.` };
    }

    if (route.module !== null && !canWith(ctx.access, route.module, route.minimum)) {
      return {
        error: `You do not have access to ${route.label}. Ask an admin if you need it.`,
      };
    }

    return {
      ok: true,
      path: query ? `${route.path}?${query}` : route.path,
      label: route.label,
    };
  },
};

const myAccess: ChatTool = {
  id: "my_access",
  description:
    "What this user's role is and which parts of DealFlow360 they can open, including any " +
    "per-account grants an admin has made. Use for 'what can I do here' questions.",
  module: null,
  minimum: "view",
  parameters: { type: "object", properties: {} },
  execute: async (_args, ctx) => {
    const granted = (Object.entries(ctx.access) as [Module, Access][]).filter(
      ([, access]) => access.capability !== "none",
    );

    return {
      role: roleLabel(ctx.role),
      modules: granted.map(([module, access]) => ({
        module: MODULE_LABELS[module],
        capability: access.capability,
        rows: access.scope,
        note: access.note ?? null,
      })),
      pages: ASSISTANT_ROUTES.filter(
        (route) => route.module === null || canWith(ctx.access, route.module, route.minimum),
      ).map((route) => ({ path: route.path, label: route.label })),
    };
  },
};

registerTool(navigate);
registerTool(myAccess);

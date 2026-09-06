import type { Capability, Module } from "@/lib/permissions";
import type { Trigger } from "./types";

/**
 * When the assistant is allowed to speak first.
 *
 * Kept in one small file because "what makes this thing talk to me unprompted"
 * is a question that deserves a single readable answer. Three constraints, all
 * enforced by the caller in the widget:
 *
 *   - only the pages listed here, and only if the user holds the module;
 *   - once per path per browser session, so navigating back and forth does not
 *     re-ask a free-tier API the same question;
 *   - never opens the panel. A nudge is a dot on the launcher the user chooses
 *     to look at. Interrupting someone mid-task to tell them something they did
 *     not ask for is the fastest way to make them turn the feature off.
 *
 * No server-only imports: the widget reads this in the browser.
 */

export type ProactiveRule = {
  /** Exact path, or a prefix ending in "/" for a detail route. */
  match: string;
  module: Module;
  minimum: Capability;
  trigger: Trigger;
  /** The turn sent on the user's behalf. */
  prompt: string;
};

export const PROACTIVE_RULES: ProactiveRule[] = [
  {
    // Deciding on one approval — the highest-value moment to have context
    // already gathered, since the alternative is deciding without it.
    match: "/approvals/",
    module: "approvals",
    minimum: "view",
    trigger: "approval_open",
    prompt:
      "I have just opened this approval to decide on it. Brief me on the risk context.",
  },
  {
    match: "/approvals",
    module: "approvals",
    minimum: "view",
    trigger: "page_load",
    prompt: "I just opened the approval queue. What most needs me?",
  },
  {
    match: "/deal-health",
    module: "dealHealth",
    minimum: "view",
    trigger: "page_load",
    prompt: "I just opened deal health. What is the most at-risk deal right now?",
  },
  {
    match: "/dashboard",
    module: "dealHealth",
    minimum: "view",
    trigger: "page_load",
    prompt: "I just opened my dashboard. Is there anything I should know about?",
  },
];

/**
 * The rule for a path, if any. Detail routes win over their list route because
 * the more specific prefix is listed first and this returns the first match.
 */
export function ruleForPath(pathname: string): ProactiveRule | null {
  return (
    PROACTIVE_RULES.find((rule) =>
      rule.match.endsWith("/")
        ? pathname.startsWith(rule.match) && pathname.length > rule.match.length
        : pathname === rule.match,
    ) ?? null
  );
}

/** What the model says when a proactive turn found nothing. Hidden, not shown. */
export const NOTHING_TO_REPORT = "Nothing needs you here right now.";

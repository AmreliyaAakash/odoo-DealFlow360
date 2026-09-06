import type { Capability, Module } from "@/lib/permissions";
import type { Role } from "@/types/globals";

/**
 * Where the assistant is allowed to send someone, and what it offers to answer.
 *
 * Keyed by module rather than by role on purpose. A role-keyed route list would
 * be a fourth copy of the access rules, and it would be wrong the moment an
 * admin grants one account a module its role does not have — the per-account
 * overrides in `user_module_permissions` are invisible to a static role list.
 * Resolving through the module means the assistant can reach exactly the pages
 * the sidebar renders and the route guard admits, and no others.
 *
 * No server-only imports: the widget reads the quick questions from the browser.
 */

export type AssistantRoute = {
  path: string;
  label: string;
  /** null = reachable by any signed-in staff user (the shared dashboard). */
  module: Module | null;
  minimum: Capability;
};

export const ASSISTANT_ROUTES: AssistantRoute[] = [
  { path: "/dashboard", label: "Dashboard", module: null, minimum: "view" },
  { path: "/quotations", label: "Quotations", module: "quotationBuilder", minimum: "view" },
  { path: "/quotations/new", label: "New quotation", module: "quotationBuilder", minimum: "write" },
  { path: "/approvals", label: "Approvals", module: "approvals", minimum: "view" },
  { path: "/fulfillment", label: "Fulfillment", module: "warehouseSplit", minimum: "view" },
  { path: "/subscriptions", label: "Subscriptions", module: "billing", minimum: "view" },
  { path: "/invoices", label: "Invoices", module: "billing", minimum: "view" },
  { path: "/deal-health", label: "Deal Health", module: "dealHealth", minimum: "view" },
  { path: "/reports", label: "Reports", module: "reports", minimum: "view" },
  { path: "/products", label: "Products", module: "products", minimum: "view" },
  { path: "/rep/upsell", label: "Upsell suggestions", module: "upsellPanel", minimum: "use" },
  { path: "/discount-setup", label: "Discount & approval rules", module: "discountRules", minimum: "view" },
  { path: "/backend/warehouses", label: "Warehouse setup", module: "warehouses", minimum: "view" },
  { path: "/backend/stock", label: "Stock levels", module: "warehouses", minimum: "view" },
  { path: "/backend/replenishment", label: "Reorder rules", module: "warehouses", minimum: "view" },
  { path: "/backend/subscriptions", label: "Subscription plans", module: "subscriptionPlans", minimum: "view" },
  { path: "/backend/upsell-rules", label: "Upsell rules", module: "upsellRules", minimum: "view" },
];

/**
 * The one-click prompts under the composer.
 *
 * Static config, not model-generated: it costs nothing, renders instantly, and
 * a role can never be shown another role's suggested question. Clicking one
 * sends its text as an ordinary message, so there is no special-case path
 * through the pipeline for it.
 */
export const QUICK_QUESTIONS: Record<Role | "none", string[]> = {
  rep: [
    "Show my quotations waiting on approval",
    "Which of my deals have gone quiet?",
    "How deep are my discounts against my usual?",
  ],
  manager: [
    "What is in my approval queue right now?",
    "Which deals have been sitting at level 1 the longest?",
    "Show the discount outliers across the team",
  ],
  finance: [
    "Show invoices with an outstanding balance",
    "What is waiting on level 2 sign-off?",
    "How much have we billed and collected so far?",
  ],
  specialist: [
    "What do I have access to?",
    "Show me what needs my attention",
  ],
  // Present because the record is keyed by Role, not because a customer gets
  // the panel: it is mounted in the dashboard shell only, and /api/assistant
  // refuses the role outright.
  customer: [],
  admin: [
    "Summarise the pipeline and the approval backlog",
    "Show the billing position across the company",
    "Which deals are at risk?",
  ],
  none: ["What can you help me with?", "What do I have access to?"],
};

export function quickQuestionsFor(role: Role | null): string[] {
  return QUICK_QUESTIONS[role ?? "none"] ?? QUICK_QUESTIONS.none;
}

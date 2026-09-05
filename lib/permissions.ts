/**
 * The access matrix, as data.
 *
 * This is the single source of truth for what each role may do, read by the UI
 * (to hide what a role cannot use), by the API (to reject what a role may not
 * write) and by the route guard. Changing a cell here changes all three, which
 * is the point — a matrix duplicated across layers drifts.
 *
 * No server-only imports live in this file, so client components can read it.
 */

import type { Role } from "@/types/globals";

export const ROLES = [
  "rep",
  "manager",
  "finance",
  "specialist",
  "customer",
  "admin",
] as const;

/* ------------------------------------------------------------------ *
 * Capability model
 * ------------------------------------------------------------------ */

/**
 * What a role may do with a module, in increasing order of power.
 *
 * `use` sits between view and write: it means acting through the module without
 * changing its configuration — a rep applies an upsell suggestion but does not
 * author the rules behind it.
 */
export const CAPABILITIES = ["none", "view", "use", "write", "full"] as const;
export type Capability = (typeof CAPABILITIES)[number];

const CAPABILITY_RANK: Record<Capability, number> = {
  none: 0,
  view: 1,
  use: 2,
  write: 3,
  full: 4,
};

/** Which rows a role may see, where a module is row-scoped. */
export type Scope = "none" | "own" | "team" | "all";

export type Access = {
  capability: Capability;
  scope: Scope;
  /** Why this cell reads the way it does, where the label alone is ambiguous. */
  note?: string;
};

export const MODULES = [
  "products",
  "discountRules",
  "warehouses",
  "subscriptionPlans",
  "upsellRules",
  "reports",
  "quotationBuilder",
  "approvals",
  "upsellPanel",
  "warehouseSplit",
  "billing",
  "customerPortal",
  "dealHealth",
] as const;

export type Module = (typeof MODULES)[number];

export const MODULE_LABELS: Record<Module, string> = {
  products: "Products & Pricing",
  discountRules: "Discount Rules",
  warehouses: "Warehouse Setup",
  subscriptionPlans: "Subscription Plans",
  upsellRules: "Upsell Rules",
  reports: "Reports Config",
  quotationBuilder: "Quotation Builder",
  approvals: "Approval Screen",
  upsellPanel: "Upsell Panel",
  warehouseSplit: "Warehouse Split",
  billing: "Billing Screen",
  customerPortal: "Customer Portal",
  dealHealth: "Deal Health Dashboard",
};

const none: Access = { capability: "none", scope: "none" };
const view = (scope: Scope = "all", note?: string): Access => ({
  capability: "view",
  scope,
  note,
});
const write = (scope: Scope = "all", note?: string): Access => ({
  capability: "write",
  scope,
  note,
});
const full = (scope: Scope = "all", note?: string): Access => ({
  capability: "full",
  scope,
  note,
});

/* ------------------------------------------------------------------ *
 * The matrix
 * ------------------------------------------------------------------ */

export const PERMISSIONS: Record<Module, Record<Role, Access>> = {
  products: {
    rep: view(),
    manager: view(),
    finance: view(),
    specialist: none,
    customer: none,
    admin: full(),
  },
  discountRules: {
    rep: none,
    manager: write(),
    finance: write("all", "Second-level tiers, above the manager's own limit"),
    specialist: none,
    customer: none,
    admin: full(),
  },
  warehouses: {
    rep: none,
    manager: none,
    finance: full(),
    specialist: none,
    customer: none,
    admin: full(),
  },
  subscriptionPlans: {
    rep: none,
    manager: none,
    finance: full(),
    specialist: none,
    customer: none,
    admin: full(),
  },
  upsellRules: {
    rep: none,
    manager: none,
    finance: none,
    specialist: none,
    customer: none,
    admin: full(),
  },
  reports: {
    // Scope, not capability, is what separates these three: the report screen
    // looks the same, the rows behind it do not.
    rep: view("own"),
    manager: view("team"),
    finance: view("all", "Financial reporting across the company"),
    specialist: none,
    customer: none,
    admin: full(),
  },
  quotationBuilder: {
    rep: full("own"),
    manager: view("all", "Review only — approvers do not edit a rep's quote"),
    finance: view("all", "Review only"),
    specialist: none,
    customer: none,
    admin: full(),
  },
  approvals: {
    rep: view("own", "Status only — a rep never decides on their own deal"),
    manager: write("all", "Level 1"),
    finance: write("all", "Level 2, the high-risk tier"),
    specialist: none,
    customer: none,
    admin: full(),
  },
  upsellPanel: {
    rep: { capability: "use", scope: "own" },
    manager: none,
    finance: none,
    specialist: none,
    customer: none,
    admin: full(),
  },
  warehouseSplit: {
    rep: write("own", "May override the suggested split on their own quote"),
    manager: view(),
    finance: full("all", "Manages allocation across every warehouse"),
    specialist: none,
    customer: none,
    admin: full(),
  },
  billing: {
    rep: view(),
    manager: view(),
    finance: write("all", "Reconciles billing"),
    specialist: none,
    customer: none,
    admin: full(),
  },
  customerPortal: {
    rep: write("own", "Responds to their own customers in the thread"),
    manager: none,
    finance: none,
    specialist: none,
    customer: full("own", "Sees and negotiates only their own quotation"),
    // Deliberately none: the portal is the customer's space, and an admin has
    // every other screen through which to see the same deal.
    admin: none,
  },
  dealHealth: {
    rep: view("own"),
    manager: view("all", "Full monitoring across the team"),
    finance: view("all", "The deals financially relevant to them"),
    specialist: none,
    customer: none,
    admin: full(),
  },
};

/* ------------------------------------------------------------------ *
 * Reading the matrix
 * ------------------------------------------------------------------ */

export function accessFor(module: Module, role: Role | null): Access {
  if (role === null) return none;
  return PERMISSIONS[module][role];
}

/** True when `role` has at least `minimum` on `module`. */
export function can(
  module: Module,
  role: Role | null,
  minimum: Capability = "view",
): boolean {
  return CAPABILITY_RANK[accessFor(module, role).capability] >= CAPABILITY_RANK[minimum];
}

/** True when the role may open the module at all. */
export function canView(module: Module, role: Role | null): boolean {
  return can(module, role, "view");
}

/** True when the role may change something in the module. */
export function canWrite(module: Module, role: Role | null): boolean {
  return can(module, role, "write");
}

/** Which rows the role may see. `none` means the module is closed to them. */
export function scopeFor(module: Module, role: Role | null): Scope {
  return accessFor(module, role).scope;
}

/**
 * True when the role sees only rows it owns. Callers must translate this into an
 * actual filter — the matrix cannot enforce a scope by itself, which is why
 * every scoped query passes through `scopeFor` explicitly.
 */
export function isOwnScoped(module: Module, role: Role | null): boolean {
  return scopeFor(module, role) === "own";
}

/* ------------------------------------------------------------------ *
 * Approval levels
 * ------------------------------------------------------------------ */

/**
 * Approval tiers. The database stores the level as the approver's role name, so
 * these two representations have to agree: level 1 is the manager's tier, level
 * 2 is finance's. An admin is not a tier — they may act on any.
 */
export const APPROVAL_LEVELS = { manager: 1, finance: 2 } as const;

export type ApprovalLevelName = keyof typeof APPROVAL_LEVELS;
export type ApprovalLevelNumber = (typeof APPROVAL_LEVELS)[ApprovalLevelName];

export const APPROVAL_LEVEL_NAMES: Record<number, ApprovalLevelName> = {
  1: "manager",
  2: "finance",
};

/** The tier a role acts at, or null for a role that is not an approver. */
export function approvalLevelForRole(role: Role | null): ApprovalLevelNumber | null {
  if (role === "manager") return APPROVAL_LEVELS.manager;
  if (role === "finance") return APPROVAL_LEVELS.finance;
  return null;
}

/**
 * Whether `role` may decide on an approval recorded at `levelName`.
 *
 * A manager may act only at level 1 and finance only at level 2 — a manager
 * cannot clear a finance-level requirement even though both can reach the
 * endpoint. Admins may act at any tier.
 */
export function canActAtLevel(role: Role | null, levelName: string): boolean {
  if (role === "admin") return true;
  if (role !== "manager" && role !== "finance") return false;
  return role === levelName;
}

import type { Module } from "@/lib/permissions";

/**
 * The four admin config tables, described once.
 *
 * The pages render from this and the API validates against it, so a field can
 * never be editable on screen and quietly rejected on save. No server-only
 * imports, so client components can read it too.
 */

export const BACKEND_ENTITIES = [
  "products",
  "discount-rules",
  "warehouses",
  "subscriptions",
] as const;

export type BackendEntity = (typeof BACKEND_ENTITIES)[number];

export function isBackendEntity(value: unknown): value is BackendEntity {
  return (
    typeof value === "string" && (BACKEND_ENTITIES as readonly string[]).includes(value)
  );
}

export type FieldType = "text" | "number" | "select" | "boolean";

export type EntityField = {
  key: string;
  label: string;
  type: FieldType;
  /** Options for a select; the API rejects anything outside them. */
  options?: readonly string[];
  required?: boolean;
  /** Not editable after creation. */
  immutable?: boolean;
  min?: number;
  max?: number;
};

export type EntityConfig = {
  table: string;
  title: string;
  module: Module;
  /** Column used as the human name in the audit trail. */
  labelColumn: string;
  orderBy: string;
  /** Deactivate instead of deleting, so historic rows keep their reference. */
  softDelete: boolean;
  fields: EntityField[];
  columns: string[];
};

const CADENCES = ["one_time", "monthly", "quarterly", "annual"] as const;
const PLAN_CADENCES = ["monthly", "quarterly", "annual"] as const;
const SCOPES = ["global", "category", "product"] as const;
const LEVELS = ["manager", "finance", "admin"] as const;

const CONFIGS: Record<BackendEntity, EntityConfig> = {
  products: {
    table: "products",
    title: "Products",
    module: "products",
    labelColumn: "name",
    orderBy: "name",
    softDelete: true,
    fields: [
      { key: "name", label: "Name", type: "text", required: true },
      { key: "sku", label: "SKU", type: "text", required: true },
      { key: "category", label: "Category", type: "text", required: true },
      { key: "list_price", label: "List price", type: "number", required: true, min: 0 },
      { key: "cost", label: "Cost", type: "number", required: true, min: 0 },
      { key: "cadence", label: "Cadence", type: "select", options: CADENCES },
      { key: "promoted", label: "Promoted", type: "boolean" },
    ],
    columns: [
      "id",
      "name",
      "sku",
      "category",
      "list_price",
      "cost",
      "cadence",
      "promoted",
      "active",
    ],
  },

  "discount-rules": {
    table: "discount_rules",
    title: "Discount Rules",
    module: "discountRules",
    labelColumn: "name",
    orderBy: "max_discount_pct",
    softDelete: true,
    fields: [
      { key: "name", label: "Name", type: "text", required: true },
      { key: "scope", label: "Scope", type: "select", options: SCOPES },
      { key: "scope_ref", label: "Applies to", type: "text" },
      {
        key: "max_discount_pct",
        label: "Max discount %",
        type: "number",
        required: true,
        min: 0,
        max: 100,
      },
      {
        key: "approval_level",
        label: "Approval level",
        type: "select",
        options: LEVELS,
        required: true,
      },
    ],
    columns: [
      "id",
      "name",
      "scope",
      "scope_ref",
      "max_discount_pct",
      "approval_level",
      "active",
    ],
  },

  warehouses: {
    table: "warehouses",
    title: "Warehouses",
    module: "warehouses",
    labelColumn: "name",
    orderBy: "priority",
    softDelete: true,
    fields: [
      { key: "name", label: "Name", type: "text", required: true },
      { key: "code", label: "Code", type: "text", required: true, immutable: true },
      { key: "region", label: "Region", type: "text" },
      { key: "priority", label: "Priority", type: "number", min: 0 },
      {
        key: "shipping_cost_weight",
        label: "Shipping cost weight",
        type: "number",
        min: 0,
      },
    ],
    columns: [
      "id",
      "name",
      "code",
      "region",
      "priority",
      "shipping_cost_weight",
      "active",
    ],
  },

  subscriptions: {
    table: "subscription_plans",
    title: "Subscription Plans",
    module: "subscriptionPlans",
    labelColumn: "name",
    orderBy: "unit_price",
    softDelete: true,
    fields: [
      { key: "name", label: "Name", type: "text", required: true },
      {
        key: "cadence",
        label: "Cadence",
        type: "select",
        options: PLAN_CADENCES,
        required: true,
      },
      { key: "unit_price", label: "Unit price", type: "number", required: true, min: 0 },
      {
        key: "min_term_months",
        label: "Min term (months)",
        type: "number",
        min: 1,
      },
    ],
    columns: ["id", "name", "cadence", "unit_price", "min_term_months", "active"],
  },
};

export function entityConfig(entity: BackendEntity): EntityConfig {
  return CONFIGS[entity];
}

export type ParsedRow = { values: Record<string, unknown> } | { error: string };

/**
 * Validates a submitted row against the entity's field list.
 *
 * `partial` is the difference between a create (every required field must be
 * present) and an edit (only what was sent is checked). Unknown keys are
 * dropped rather than rejected, so an extra field from the client cannot reach
 * the table.
 */
export function parseRow(
  entity: BackendEntity,
  payload: unknown,
  { partial }: { partial: boolean },
): ParsedRow {
  if (typeof payload !== "object" || payload === null) {
    return { error: "Body must be an object" };
  }

  const input = payload as Record<string, unknown>;
  const values: Record<string, unknown> = {};

  for (const field of entityConfig(entity).fields) {
    const present = field.key in input;

    if (!present) {
      if (!partial && field.required) {
        return { error: `${field.label} is required` };
      }
      continue;
    }

    // An immutable column may be set on create but never changed afterwards.
    if (partial && field.immutable) continue;

    const raw = input[field.key];

    if (raw === null || raw === "") {
      // A flag has no null: an absent checkbox is off, and writing null would
      // only fail against a not-null column.
      if (field.type === "boolean") {
        values[field.key] = false;
        continue;
      }
      if (field.required) return { error: `${field.label} is required` };
      values[field.key] = null;
      continue;
    }

    if (field.type === "number") {
      const value = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(value)) {
        return { error: `${field.label} must be a number` };
      }
      if (field.min !== undefined && value < field.min) {
        return { error: `${field.label} must be at least ${field.min}` };
      }
      if (field.max !== undefined && value > field.max) {
        return { error: `${field.label} must be at most ${field.max}` };
      }
      values[field.key] = value;
      continue;
    }

    if (field.type === "boolean") {
      // Accepts a real boolean and the string a form value round-trips into,
      // because the editor stores every draft field as text.
      if (typeof raw === "boolean") {
        values[field.key] = raw;
        continue;
      }
      if (raw === "true" || raw === "false") {
        values[field.key] = raw === "true";
        continue;
      }
      return { error: `${field.label} must be true or false` };
    }

    if (typeof raw !== "string") {
      return { error: `${field.label} must be text` };
    }

    if (field.type === "select" && field.options && !field.options.includes(raw)) {
      return { error: `${field.label} must be one of: ${field.options.join(", ")}` };
    }

    values[field.key] = raw.trim();
  }

  return { values };
}

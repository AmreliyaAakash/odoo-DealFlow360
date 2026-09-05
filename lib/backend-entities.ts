import type { Module } from "@/lib/permissions";

/**
 * The admin config tables, described once.
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
  "upsell-rules",
  "replenishment",
] as const;

export type BackendEntity = (typeof BACKEND_ENTITIES)[number];

export function isBackendEntity(value: unknown): value is BackendEntity {
  return (
    typeof value === "string" && (BACKEND_ENTITIES as readonly string[]).includes(value)
  );
}

export type FieldType =
  | "text"
  | "number"
  | "select"
  | "boolean"
  | "reference";

/**
 * Where a `reference` field gets its choices.
 *
 * Named rather than inlined so the page can load every lookup a config needs in
 * one pass, and so the API can check a submitted id against the same table the
 * dropdown was built from — a stale tab offering a product that has since been
 * archived is caught on save rather than written.
 */
export type ReferenceSource = {
  table: string;
  labelColumn: string;
  /** Only rows where this column is true are offered. */
  activeColumn?: string;
};

export type EntityField = {
  key: string;
  label: string;
  type: FieldType;
  /** Options for a select; the API rejects anything outside them. */
  options?: readonly string[];
  /** Where a reference field's options come from. */
  reference?: ReferenceSource;
  required?: boolean;
  /** Not editable after creation. */
  immutable?: boolean;
  min?: number;
  max?: number;
  /** Shown under the input in the editor. */
  hint?: string;
};

const PRODUCT_REF: ReferenceSource = {
  table: "products",
  labelColumn: "name",
  activeColumn: "active",
};

const WAREHOUSE_REF: ReferenceSource = {
  table: "warehouses",
  labelColumn: "name",
  activeColumn: "active",
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

  "upsell-rules": {
    table: "upsell_rules",
    title: "Upsell Rules",
    module: "upsellRules",
    labelColumn: "name",
    orderBy: "priority",
    softDelete: true,
    fields: [
      { key: "name", label: "Name", type: "text", required: true },
      {
        key: "trigger_product_id",
        label: "Triggered by product",
        type: "reference",
        reference: PRODUCT_REF,
        hint: "Fires when this exact product is on the quote.",
      },
      {
        key: "trigger_category",
        label: "…or by category",
        type: "text",
        hint: "Fires on any product in this category. Use one trigger or the other.",
      },
      {
        key: "suggested_product_id",
        label: "Suggest",
        type: "reference",
        reference: PRODUCT_REF,
        required: true,
      },
      {
        key: "priority",
        label: "Priority",
        type: "number",
        min: 0,
        hint: "Lower wins when several rules suggest the same product.",
      },
      {
        key: "min_margin_pct",
        label: "Min margin %",
        type: "number",
        min: 0,
        max: 100,
        hint: "Below this margin the suggestion is withheld. Blank uses the 15% floor.",
      },
    ],
    columns: [
      "id",
      "name",
      "trigger_product_id",
      "trigger_category",
      "suggested_product_id",
      "priority",
      "min_margin_pct",
      "active",
    ],
  },

  replenishment: {
    table: "replenishment_rules",
    title: "Replenishment Rules",
    module: "warehouses",
    labelColumn: "id",
    orderBy: "reorder_point",
    softDelete: true,
    fields: [
      {
        key: "warehouse_id",
        label: "Warehouse",
        type: "reference",
        reference: WAREHOUSE_REF,
        required: true,
      },
      {
        key: "product_id",
        label: "Product",
        type: "reference",
        reference: PRODUCT_REF,
        required: true,
      },
      {
        key: "reorder_point",
        label: "Reorder at",
        type: "number",
        required: true,
        min: 0,
        hint: "When available stock falls to this level, the line needs reordering.",
      },
      {
        key: "reorder_qty",
        label: "Reorder quantity",
        type: "number",
        required: true,
        min: 1,
        hint: "How much to bring in. Suggested orders round up to a multiple of this.",
      },
      {
        key: "lead_time_days",
        label: "Lead time (days)",
        type: "number",
        min: 0,
      },
    ],
    columns: [
      "id",
      "warehouse_id",
      "product_id",
      "reorder_point",
      "reorder_qty",
      "lead_time_days",
      "active",
    ],
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

    if (field.type === "reference") {
      // Shape only. Whether the row exists is the foreign key's job — checking
      // it here as well would be a second query that can still be wrong by the
      // time the insert runs.
      if (!UUID.test(raw)) {
        return { error: `${field.label} must be chosen from the list` };
      }
      values[field.key] = raw;
      continue;
    }

    if (field.type === "select" && field.options && !field.options.includes(raw)) {
      return { error: `${field.label} must be one of: ${field.options.join(", ")}` };
    }

    values[field.key] = raw.trim();
  }

  // On a create every field is present, so the cross-field rules can be
  // settled here. On an edit they cannot — a field the request did not send is
  // unknown at this point — so PATCH re-checks the merged row instead.
  if (!partial) {
    const crossField = checkEntityRules(entity, values);
    if (crossField) return { error: crossField };
  }

  return { values };
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Rules that involve more than one field, which the field list cannot express.
 *
 * These are the ones that produce config that looks saved and silently does
 * nothing — a rule with no trigger never matches a cart, a rule suggesting what
 * it triggers on is noise, and a reorder quantity that cannot lift stock above
 * its own reorder point re-fires forever. Rejecting them at the door is much
 * kinder than leaving an admin to work out why their rule never fires.
 *
 * Always given a complete row: a create builds one from the request, an edit
 * merges the request over what is stored. Judging a half-row would either miss
 * a rule the edit broke or reject an edit for config that was already there.
 */
export function checkEntityRules(
  entity: BackendEntity,
  row: Record<string, unknown>,
): string | null {
  const value = (key: string) => row[key] ?? null;

  if (entity === "upsell-rules") {
    if (!value("trigger_product_id") && !value("trigger_category")) {
      return "An upsell rule needs a trigger: choose a product, or name a category.";
    }

    if (
      value("suggested_product_id") !== null &&
      value("suggested_product_id") === value("trigger_product_id")
    ) {
      return "A rule cannot suggest the product that triggers it.";
    }
  }

  if (entity === "replenishment") {
    const point = Number(value("reorder_point") ?? 0);
    const qty = Number(value("reorder_qty") ?? 0);

    // One delivery has to clear the trigger. Stock can be as low as zero when
    // the rule fires, so a quantity no larger than the reorder point can land
    // and leave the line still below it — and the rule fires again, forever.
    if (qty <= point) {
      return `Reorder quantity must be more than the reorder point (${point}), or a delivery would arrive and still leave stock below it.`;
    }
  }

  return null;
}

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
  "price-lists",
  "warehouses",
  "subscriptions",
  "upsell-rules",
  "replenishment",
] as const;

export type BackendEntity = (typeof BACKEND_ENTITIES)[number];

export function isBackendEntity(value: unknown): value is BackendEntity {
  return (
    typeof value === "string" &&
    (BACKEND_ENTITIES as readonly string[]).includes(value)
  );
}

export type FieldType = "text" | "number" | "select" | "boolean" | "reference";

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
  /**
   * Another field on this entity whose value must not be picked here.
   *
   * The chosen row is removed from this field's options, so the clash cannot be
   * made in the first place. Rejecting it on save is still correct — a second
   * tab, or a direct API call, does not go through this dropdown — but being
   * told at the end of a form what could have been prevented at the start is a
   * poor trade.
   */
  distinctFrom?: string;
  /**
   * Existing values for a free-text field, offered as suggestions.
   *
   * A category is matched by exact string, so "server" and "Servers" are
   * different categories and a rule naming one that no product uses never
   * fires. Offering what is actually in the catalogue turns a silent dead rule
   * into a two-character choice.
   */
  suggestFrom?: { table: string; column: string };
  required?: boolean;
  /** Not editable after creation. */
  immutable?: boolean;
  min?: number;
  max?: number;
  /** Shown under the input in the editor. */
  hint?: string;
  /**
   * Section heading this field belongs under in the editor.
   *
   * A config row is a set of separate decisions — what to call it, when it
   * fires, what it does — and a single flat column of inputs makes the reader
   * work that structure out for themselves every time. Fields keep their
   * declared order within a section; anything ungrouped sits in the first one.
   */
  group?: string;
  /** Narrow fields pair up on one row; the default is full width. */
  width?: "half";
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
      {
        key: "list_price",
        label: "List price",
        type: "number",
        required: true,
        min: 0,
      },
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

  "price-lists": {
    table: "price_lists",
    title: "Price Lists",
    module: "products",
    labelColumn: "name",
    orderBy: "name",
    softDelete: true,
    fields: [
      { key: "name", label: "Name", type: "text", required: true },
      {
        key: "product_id",
        label: "Product (optional)",
        type: "reference",
        reference: PRODUCT_REF,
        hint: "Leave empty to apply to all products for this customer tier.",
      },
      {
        key: "tier",
        label: "Customer tier",
        type: "select",
        options: ["standard", "silver", "gold", "platinum"] as const,
        required: true,
      },
      { key: "currency", label: "Currency", type: "text", required: true },
      {
        key: "rule",
        label: "Pricing rule",
        type: "select",
        options: ["percent_off", "fixed", "none"] as const,
        required: true,
      },
      {
        key: "amount",
        label: "Adjustment amount / %",
        type: "number",
        required: true,
        min: 0,
        hint: "Percent discount off base (e.g. 10 for 10% off) or fixed override price.",
      },
    ],
    columns: ["id", "name", "product_id", "tier", "currency", "rule", "amount", "active"],
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
      {
        key: "code",
        label: "Code",
        type: "text",
        required: true,
        immutable: true,
      },
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
      {
        key: "unit_price",
        label: "Unit price",
        type: "number",
        required: true,
        min: 0,
      },
      {
        key: "min_term_months",
        label: "Min term (months)",
        type: "number",
        min: 1,
      },
    ],
    columns: [
      "id",
      "name",
      "cadence",
      "unit_price",
      "min_term_months",
      "active",
    ],
  },

  "upsell-rules": {
    table: "upsell_rules",
    title: "Upsell Rules",
    module: "upsellRules",
    labelColumn: "name",
    orderBy: "priority",
    softDelete: true,
    fields: [
      {
        key: "name",
        label: "Name",
        type: "text",
        required: true,
        group: "Rule",
        hint: 'How this rule appears in the list. Say what it pairs, e.g. "Servers → Support Standard".',
      },
      {
        key: "trigger_product_id",
        label: "Triggered by product",
        group: "When it fires",
        type: "reference",
        reference: PRODUCT_REF,
        distinctFrom: "suggested_product_id",
        hint: "Fires when this exact product is on the quote.",
      },
      {
        key: "trigger_category",
        label: "…or by category",
        group: "When it fires",
        type: "text",
        suggestFrom: { table: "products", column: "category" },
        hint: "Fires on any product in this category. Set one trigger or the other, not both.",
      },
      {
        key: "suggested_product_id",
        label: "Suggest",
        group: "What it suggests",
        type: "reference",
        reference: PRODUCT_REF,
        distinctFrom: "trigger_product_id",
        required: true,
      },
      {
        key: "priority",
        label: "Priority",
        group: "What it suggests",
        width: "half",
        type: "number",
        min: 0,
        hint: "Lower wins when several rules suggest the same product.",
      },
      {
        key: "min_margin_pct",
        label: "Min margin %",
        group: "What it suggests",
        width: "half",
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
        group: "Which line",
        width: "half",
        type: "reference",
        reference: WAREHOUSE_REF,
        required: true,
      },
      {
        key: "product_id",
        label: "Product",
        group: "Which line",
        width: "half",
        type: "reference",
        reference: PRODUCT_REF,
        required: true,
      },
      {
        key: "reorder_point",
        label: "Reorder at",
        group: "What to do",
        width: "half",
        type: "number",
        required: true,
        min: 0,
        hint: "When available stock falls to this level, the line needs reordering.",
      },
      {
        key: "reorder_qty",
        label: "Reorder quantity",
        group: "What to do",
        width: "half",
        type: "number",
        required: true,
        min: 1,
        hint: "How much to bring in. Suggested orders round up to a multiple of this.",
      },
      {
        key: "lead_time_days",
        label: "Lead time (days)",
        group: "What to do",
        width: "half",
        type: "number",
        min: 0,
        hint: "Calendar days from ordering to arrival.",
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

      // On create, leave the column out rather than writing null into it. A
      // column default only fires when the column is absent from the INSERT —
      // passing null explicitly overrides it and fails outright against a
      // not-null column, which is what an optional-in-the-form field like
      // `warehouses.shipping_cost_weight` (not null default 1) does. Omitting
      // is also equivalent to null for a nullable column, so this is safe for
      // every optional field rather than a special case for one.
      if (!partial) continue;

      // On update, null is the user clearing a value they can see, so it is
      // written as asked.
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

    if (
      field.type === "select" &&
      field.options &&
      !field.options.includes(raw)
    ) {
      return {
        error: `${field.label} must be one of: ${field.options.join(", ")}`,
      };
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    const triggerProduct = value("trigger_product_id");
    const triggerCategory = value("trigger_category");

    if (!triggerProduct && !triggerCategory) {
      return "An upsell rule needs a trigger: choose a product, or name a category.";
    }

    // Two triggers widen the rule rather than narrowing it: the matcher ORs
    // them, so the rule fires on that product *or* on anything in that
    // category. Anyone filling both fields means the opposite, so this is
    // refused rather than quietly saved as something broader than intended.
    if (triggerProduct && triggerCategory) {
      return "Set one trigger, not both. A rule with a product and a category fires on either of them, which is wider than it looks — clear whichever you did not mean.";
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

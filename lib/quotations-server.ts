import type { SupabaseClient } from "@supabase/supabase-js";
import {
  requiredApprovals,
  riskScore,
  type RequiredApproval,
} from "@/lib/business-logic";
import {
  PRODUCT_COLUMNS,
  summarize,
  unitPriceFor,
  type Product,
  type QuotationLineInput,
  type QuotationSummary,
} from "@/lib/quotations";

export type PricingFailure = { ok: false; error: string; status: number };

export type PricingSuccess = {
  ok: true;
  summary: QuotationSummary;
  approvals: RequiredApproval[];
  productsById: Map<string, Product>;
};

/**
 * Re-prices lines from the database rather than trusting numbers sent by the
 * client, and derives which approval levels the resulting deal needs.
 */
export async function priceLines(
  supabase: SupabaseClient,
  lines: QuotationLineInput[],
): Promise<PricingSuccess | PricingFailure> {
  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_COLUMNS)
    .in(
      "id",
      lines.map((line) => line.productId),
    )
    .returns<Product[]>();

  if (error) {
    return { ok: false, error: error.message, status: 500 };
  }

  const productsById = new Map((data ?? []).map((product) => [product.id, product]));
  const unknown = lines.find((line) => !productsById.has(line.productId));
  if (unknown) {
    return {
      ok: false,
      error: `Unknown product: ${unknown.productId}`,
      status: 400,
    };
  }

  const summary = summarize(lines, productsById);

  return {
    ok: true,
    summary,
    approvals: requiredApprovals(summary),
    productsById,
  };
}

/** Replaces a quotation's lines wholesale, snapshotting price and cost per line. */
export async function replaceQuotationLines(
  supabase: SupabaseClient,
  quotationId: string,
  lines: QuotationLineInput[],
  productsById: Map<string, Product>,
): Promise<{ error: string } | null> {
  const { error: deleteError } = await supabase
    .from("quotation_lines")
    .delete()
    .eq("quotation_id", quotationId);

  if (deleteError) return { error: deleteError.message };

  if (lines.length === 0) return null;

  const { error: insertError } = await supabase.from("quotation_lines").insert(
    lines.map((line) => {
      const product = productsById.get(line.productId)!;
      return {
        quotation_id: quotationId,
        product_id: line.productId,
        qty: line.qty,
        discount_pct: line.discountPct,
        // Price is the rep's, cost is the catalog's — a negotiated price must
        // never be able to talk the margin up with it.
        unit_price: unitPriceFor(product, line),
        unit_cost: product.cost,
        subscription_plan_id: line.subscriptionPlanId ?? null,
      };
    }),
  );

  return insertError ? { error: insertError.message } : null;
}

/** Column values derived from a priced summary, shared by the create and update paths. */
export function summaryColumns(summary: QuotationSummary, approvals: RequiredApproval[]) {
  return {
    subtotal: summary.gross,
    discount_total: summary.discount,
    net_total: summary.net,
    cost_total: summary.cost,
    margin_total: summary.margin,
    max_discount_pct: summary.maxDiscountPct,
    risk_score: riskScore(summary),
    required_approvals: [...new Set(approvals.map((approval) => approval.level))],
  };
}

/** Validates a `lines` payload, returning `null` when the shape is wrong. */
export function parseLines(value: unknown): QuotationLineInput[] | null {
  if (!Array.isArray(value)) return null;

  const lines: QuotationLineInput[] = [];

  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) return null;

    const { productId, qty, discountPct, unitPrice, subscriptionPlanId } =
      raw as Record<string, unknown>;

    if (typeof productId !== "string" || productId.length === 0) return null;
    if (typeof qty !== "number" || !Number.isFinite(qty) || qty <= 0) return null;
    if (
      typeof discountPct !== "number" ||
      !Number.isFinite(discountPct) ||
      discountPct < 0 ||
      discountPct > 100
    ) {
      return null;
    }
    if (
      unitPrice !== undefined &&
      unitPrice !== null &&
      (typeof unitPrice !== "number" || !Number.isFinite(unitPrice) || unitPrice < 0)
    ) {
      return null;
    }
    if (
      subscriptionPlanId !== undefined &&
      subscriptionPlanId !== null &&
      typeof subscriptionPlanId !== "string"
    ) {
      return null;
    }

    // `category` is accepted in the payload and deliberately dropped: the client
    // sends it so its own validation reads clearly, but the server re-derives it
    // from the product rather than believing it.
    lines.push({
      productId,
      qty,
      discountPct,
      unitPrice: (unitPrice as number | null | undefined) ?? null,
      subscriptionPlanId: (subscriptionPlanId as string | null | undefined) ?? null,
    });
  }

  return lines;
}

export const LINES_SHAPE_ERROR =
  "lines must be an array of { productId, qty, discountPct, unitPrice?, subscriptionPlanId? }";

/**
 * The approval verdict the builder shows the rep after saving.
 *
 * Computed from the re-priced summary, never from what the client sent, so the
 * banner and the row in `quotations.required_approvals` cannot disagree.
 */
export type ApprovalVerdict = {
  blendedRiskScore: number;
  needsManager: boolean;
  needsFinance: boolean;
  needsAdmin: boolean;
  requiredApprovals: RequiredApproval[];
};

export function approvalVerdict(
  summary: QuotationSummary,
  approvals: RequiredApproval[],
): ApprovalVerdict {
  const levels = new Set(approvals.map((approval) => approval.level));

  return {
    blendedRiskScore: riskScore(summary),
    needsManager: levels.has("manager"),
    needsFinance: levels.has("finance"),
    needsAdmin: levels.has("admin"),
    requiredApprovals: approvals,
  };
}

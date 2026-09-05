import "server-only";
import {
  asCustomerTier,
  discountCeiling,
  riskScoreFromTotals,
  type DiscountRule,
} from "@/lib/business-logic";
import { shortId } from "@/lib/roles";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { nameFor, resolveUserNames } from "@/lib/users-server";
import type { Role } from "@/types/globals";

/**
 * The approval queue, in one place.
 *
 * Both the manager dashboard and /approvals show "what is waiting on me", and
 * they must agree — a deal visible on one screen and missing from the other is
 * a deal nobody signs. So the row shape, the filter and the violation detection
 * live here, and each screen brings its own query or reuses `PENDING_SELECT`.
 */

export type ViolatingLine = {
  id: string;
  productName: string;
  qty: number;
  discountPct: number;
  unitPrice: number;
  /** Which discount rule this line breaches. */
  rule: string;
};

export type PendingApproval = {
  id: string;
  reference: string;
  repId: string;
  repName: string;
  customer: string;
  amount: number;
  margin: number;
  marginPct: number | null;
  maxDiscountPct: number;
  riskScore: number;
  requiredApprovals: string[];
  submittedAt: string | null;
  violatingLines: ViolatingLine[];
};

/** A discount rule as the queue needs it: the ceiling plus a name to cite. */
export type ApprovalDiscountRule = DiscountRule & { name: string };

/**
 * Columns the queue needs. The customer's tier and the product's cadence are in
 * here because the ceiling depends on both — a Gold account and a subscription
 * line are allowed further than a standard account and a server.
 */
export const PENDING_SELECT = `
  id, reference, rep_id, status, net_total, margin_total, max_discount_pct,
  required_approvals, submitted_at,
  customers(name, tier),
  quotation_lines(
    id, qty, discount_pct, unit_price,
    products(id, name, sku, category, cadence)
  )
`;

export const DISCOUNT_RULE_SELECT =
  "name, scope, scope_ref, customer_tier, max_discount_pct";

export type QuotationRow = {
  id: string;
  reference: string | null;
  rep_id: string;
  status: string | null;
  net_total: number | null;
  margin_total: number | null;
  max_discount_pct: number | null;
  required_approvals: string[] | null;
  submitted_at: string | null;
  customers: { name: string | null; tier: string | null } | null;
  quotation_lines:
    | {
        id: string;
        qty: number | null;
        discount_pct: number | null;
        unit_price: number | null;
        products: {
          id: string;
          name: string | null;
          sku: string | null;
          category: string | null;
          cadence: string | null;
        } | null;
      }[]
    | null;
};

/**
 * Turns quotation rows into the queue.
 *
 * An approver sees only the deals that asked for their level; an admin sees
 * every queue, because somebody has to be able to unblock a level nobody holds.
 * A rep holds no level at all, so filtering by level would show them nothing —
 * they get every pending deal they are allowed to read, which RLS has already
 * narrowed to their own. Highest risk first: this is a work list, not a log.
 */
export function buildPendingApprovals(
  rows: QuotationRow[],
  rules: ApprovalDiscountRule[],
  repNames: Map<string, string>,
  role: Role | null,
): PendingApproval[] {
  return rows
    .filter((row) => row.status === "pending_approval")
    .filter((row) => {
      if (role === "admin" || role === "rep" || role === null) return true;
      return (row.required_approvals ?? []).includes(role);
    })
    .map((row) => {
      const net = Number(row.net_total ?? 0);
      const margin = Number(row.margin_total ?? 0);
      const maxDiscountPct = Number(row.max_discount_pct ?? 0);

      return {
        id: row.id,
        reference: row.reference ?? shortId(row.id),
        repId: row.rep_id,
        repName: nameFor(repNames, row.rep_id),
        customer: row.customers?.name ?? "Unassigned",
        amount: net,
        margin,
        marginPct: net === 0 ? null : margin / net,
        maxDiscountPct,
        riskScore: riskScoreFromTotals({ maxDiscountPct, net, margin }),
        requiredApprovals: row.required_approvals ?? [],
        submittedAt: row.submitted_at,
        violatingLines: findViolations(row, rules),
      };
    })
    .sort((a, b) => b.riskScore - a.riskScore);
}

/**
 * Lines discounted past the ceiling that actually applies to them.
 *
 * The ceiling is resolved through the same function the builder shows the rep,
 * tier included, so the warning an approver reads here is the one the rep was
 * shown before they sent it — not a stricter rule they never saw.
 */
export function findViolations(
  row: QuotationRow,
  rules: ApprovalDiscountRule[],
): ViolatingLine[] {
  const tier = asCustomerTier(row.customers?.tier);
  const violations: ViolatingLine[] = [];

  for (const line of row.quotation_lines ?? []) {
    const discountPct = Number(line.discount_pct ?? 0);
    const product = line.products;
    if (discountPct === 0 || !product) continue;

    const facts = {
      id: product.id,
      sku: product.sku,
      category: product.category ?? "Uncategorized",
      cadence: (product.cadence ?? "one_time") as
        | "one_time"
        | "monthly"
        | "quarterly"
        | "annual",
    };

    const ceiling = discountCeiling(facts, tier, rules);
    if (ceiling === null || discountPct <= ceiling) continue;

    // Name the rule that set the ceiling, so the approver can go and argue with
    // the rule rather than with the rep.
    const binding = rules.find(
      (rule) =>
        Number(rule.max_discount_pct) === ceiling &&
        (rule.customer_tier === null || rule.customer_tier === tier),
    );

    violations.push({
      id: line.id,
      productName: product.name ?? "Unknown product",
      qty: Number(line.qty ?? 0),
      discountPct,
      unitPrice: Number(line.unit_price ?? 0),
      rule: binding
        ? `${binding.name} · max ${ceiling.toFixed(0)}%`
        : `max ${ceiling.toFixed(0)}%`,
    });
  }

  return violations.sort((a, b) => b.discountPct - a.discountPct);
}

/** The queue for one approver, fetched and built. Used by /approvals. */
export async function loadPendingApprovals(
  role: Role | null,
): Promise<{ pending: PendingApproval[]; loadError: string | null }> {
  const supabase = createServerSupabaseClient();

  const [quotations, rules] = await Promise.all([
    supabase
      .from("quotations")
      .select(PENDING_SELECT)
      .eq("status", "pending_approval")
      .order("submitted_at", { ascending: false, nullsFirst: false })
      .returns<QuotationRow[]>(),
    supabase
      .from("discount_rules")
      .select(DISCOUNT_RULE_SELECT)
      .eq("active", true)
      .returns<ApprovalDiscountRule[]>(),
  ]);

  const loadError = quotations.error?.message ?? rules.error?.message ?? null;
  if (loadError) return { pending: [], loadError };

  const rows = quotations.data ?? [];
  const repNames = await resolveUserNames(rows.map((row) => row.rep_id));

  return {
    pending: buildPendingApprovals(rows, rules.data ?? [], repNames, role),
    loadError: null,
  };
}

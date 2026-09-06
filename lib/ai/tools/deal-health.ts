import "server-only";
import {
  daysStalled,
  hasSlippedPromise,
  isDiscountAnomaly,
  isStalled,
} from "@/lib/business-logic";
import { loadDealHealth } from "@/lib/deal-health-server";
import { formatCurrency } from "@/lib/quotations";
import { statusLabel } from "@/lib/status";
import { registerTool } from "../tool-registry";
import type { ChatTool } from "../types";

/**
 * "Which deals have gone quiet?" and "is this discount out of character?".
 *
 * The flags are computed by the same functions the dashboard renders from, not
 * re-described for the model. A stalled deal is stalled by one definition in
 * this product, and it is the one in `business-logic.ts`.
 */

const dealHealth: ChatTool = {
  id: "deal_health",
  description:
    "Open deals flagged as at risk: stalled past the SLA for their stage, discounted well " +
    "above the rep's own baseline, or worked past the date the customer was promised. " +
    "A rep sees only their own deals.",
  module: "dealHealth",
  minimum: "view",
  parameters: {
    type: "object",
    properties: {
      flag: {
        type: "string",
        enum: ["stalled", "discount", "slipped", "any"],
        description: "Narrow to one kind of risk. Defaults to any.",
      },
      limit: { type: "integer", description: "How many to return (default 10, max 25)." },
    },
  },
  execute: async (args, ctx) => {
    const { quotations, baselines, error } = await loadDealHealth(
      ctx.scope === "own" ? ctx.userId : null,
    );
    if (error) return { error: "Could not read the deal health data." };

    const now = new Date();
    const wanted = typeof args.flag === "string" ? args.flag : "any";

    const scored = quotations.map((quotation) => {
      const baseline = baselines[quotation.rep_id ?? ""] ?? null;
      return {
        quotation,
        baseline,
        stalled: isStalled(quotation, now),
        discount: isDiscountAnomaly(quotation, baseline),
        slipped: hasSlippedPromise(quotation, now),
      };
    });

    const flagged = scored.filter((row) => {
      if (wanted === "stalled") return row.stalled;
      if (wanted === "discount") return row.discount;
      if (wanted === "slipped") return row.slipped;
      return row.stalled || row.discount || row.slipped;
    });

    const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 25);

    return {
      scope: ctx.scope,
      openDeals: quotations.length,
      flagged: flagged.length,
      valueAtRisk: formatCurrency(
        flagged.reduce((sum, row) => sum + Number(row.quotation.net_total ?? 0), 0),
      ),
      deals: flagged.slice(0, limit).map((row) => ({
        reference: row.quotation.reference ?? row.quotation.id.slice(0, 8),
        status: statusLabel(row.quotation.status ?? "draft"),
        value: formatCurrency(Number(row.quotation.net_total ?? 0)),
        maxDiscountPct: Number(row.quotation.max_discount_pct ?? 0),
        repBaselinePct: row.baseline,
        businessDaysQuiet: daysStalled(row.quotation, now),
        flags: [
          row.stalled ? "stalled" : null,
          row.discount ? "discount anomaly" : null,
          row.slipped ? "promise date passed" : null,
        ].filter(Boolean),
        page: `/quotations/${row.quotation.id}`,
      })),
    };
  },
};

registerTool(dealHealth);

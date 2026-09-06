import "server-only";
import { loadOverview } from "@/lib/dashboard-server";
import { formatCurrency } from "@/lib/quotations";
import { loadReportStats } from "@/lib/reports-stats-server";
import { registerTool } from "../tool-registry";
import type { ChatTool } from "../types";

/**
 * The numbers somebody quotes in a standup.
 *
 * `loadOverview` and `loadReportStats` both take the caller's scope as an
 * argument rather than reading a role, which is exactly what this layer needs:
 * the same call, from the same request, returns a rep's own pipeline or the
 * whole desk's depending on what the matrix said — and the tool never has to
 * know which of those happened.
 */

const pipelineOverview: ChatTool = {
  id: "pipeline_overview",
  description:
    "Headline numbers: open quotations and their value, what is pending approval, what has " +
    "been won this month, and the last few things that happened. Scoped to the user.",
  module: "reports",
  minimum: "view",
  parameters: { type: "object", properties: {} },
  execute: async (_args, ctx) => {
    const overview = await loadOverview(ctx.userId, ctx.scope);
    if (overview.error) return { error: "Could not read the pipeline figures." };

    return {
      scope: ctx.scope,
      open: { count: overview.openQuotations, value: formatCurrency(overview.openValue) },
      pendingApproval: {
        count: overview.pendingApprovals,
        value: formatCurrency(overview.pendingValue),
      },
      wonThisMonth: {
        count: overview.wonThisMonth,
        value: formatCurrency(overview.wonValue),
      },
      recentActivity: overview.activity.slice(0, 8).map((event) => ({
        what: event.summary,
        who: event.actor,
        quotation: event.reference,
        at: event.at,
      })),
    };
  },
};

const performanceStats: ChatTool = {
  id: "performance_stats",
  description:
    "Ninety-day performance: quotations created, average business days from submission to " +
    "the decision that cleared it, and the most-upsold product. Scoped to the user.",
  module: "reports",
  minimum: "view",
  parameters: { type: "object", properties: {} },
  execute: async (_args, ctx) => {
    const stats = await loadReportStats(ctx.scope, ctx.userId);
    if (stats.error) return { error: "Could not read the performance figures." };

    return {
      scope: ctx.scope,
      windowDays: 90,
      quotesCreated: stats.quotesCreated,
      avgApprovalBusinessDays: stats.avgApprovalDays,
      approvalsMeasured: stats.approvalsMeasured,
      topUpsoldProduct: stats.topUpsoldProduct,
      topUpsoldCount: stats.topUpsoldCount,
    };
  },
};

registerTool(pipelineOverview);
registerTool(performanceStats);

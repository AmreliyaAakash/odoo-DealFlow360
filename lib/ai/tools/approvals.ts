import "server-only";
import { loadPendingApprovals } from "@/lib/approvals-server";
import { canActAtLevel } from "@/lib/permissions";
import { formatCurrency } from "@/lib/quotations";
import { registerTool } from "../tool-registry";
import type { ChatTool } from "../types";

/**
 * The approval queue, narrowed to the tier the caller actually decides at.
 *
 * A manager and a finance user both open the same screen and both pass the same
 * capability check, and they are looking at different work: level 1 is the
 * manager's, level 2 is finance's, and neither clears the other's requirement.
 * Handing the model the whole queue and trusting the prompt to filter it would
 * put a manager one confused sentence away from reading finance's backlog.
 */

const approvalQueue: ChatTool = {
  id: "approval_queue",
  description:
    "Quotations waiting on an approval decision, ordered by risk. Only the tier the user " +
    "can actually decide at is included (level 1 for a manager, level 2 for finance, both " +
    "for an admin). A rep sees the status of their own submissions only.",
  module: "approvals",
  minimum: "view",
  parameters: {
    type: "object",
    properties: {
      limit: { type: "integer", description: "How many to return (default 10, max 25)." },
    },
  },
  execute: async (args, ctx) => {
    const { pending, loadError } = await loadPendingApprovals(ctx.role);
    if (loadError) return { error: "Could not read the approval queue." };

    const mine = pending.filter((item) => {
      // Scope first: a rep watching their own submissions, not a queue.
      if (ctx.scope === "own" && item.repId !== ctx.userId) return false;

      // Then tier. An admin clears any; a rep decides nothing, but still sees
      // where their own quote is sitting.
      if (ctx.role === "rep" || ctx.role === null) return true;
      return item.requiredApprovals.some((level) => canActAtLevel(ctx.role, level));
    });

    const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 25);
    const page = [...mine].sort((a, b) => b.riskScore - a.riskScore).slice(0, limit);

    return {
      waiting: mine.length,
      totalValue: formatCurrency(mine.reduce((sum, item) => sum + item.amount, 0)),
      canDecide: ctx.role === "manager" || ctx.role === "finance" || ctx.role === "admin",
      queue: page.map((item) => ({
        reference: item.reference,
        customer: item.customer,
        rep: item.repName,
        value: formatCurrency(item.amount),
        marginPct: item.marginPct,
        maxDiscountPct: item.maxDiscountPct,
        riskScore: item.riskScore,
        needs: item.requiredApprovals,
        submittedAt: item.submittedAt,
        breaches: item.violatingLines.map((line) => ({
          product: line.productName,
          discountPct: line.discountPct,
          rule: line.rule,
        })),
        page: `/approvals/${item.id}`,
      })),
    };
  },
};

registerTool(approvalQueue);

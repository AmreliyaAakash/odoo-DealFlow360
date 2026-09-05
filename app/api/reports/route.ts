import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";
import type { Scope } from "@/lib/permissions";

/** STRUCTURE ONLY — aggregation queries are not implemented (A7). */

export type ReportFilters = {
  period: string | null;
  repId: string | null;
  status: string | null;
  product: string | null;
};

export type ReportRow = {
  quotationId: string;
  reference: string | null;
  customer: string | null;
  rep: string | null;
  status: string | null;
  netTotal: number;
  marginPct: number | null;
  createdAt: string | null;
};

export type ReportResponse = {
  filters: ReportFilters;
  /** Which rows the caller was allowed to ask for. */
  scope: Scope;
  rows: ReportRow[];
  totals: { netTotal: number; marginPct: number | null; count: number };
};

/**
 * Reporting is where scope matters more than capability: every internal role can
 * open this endpoint, and what separates them is which rows come back. A rep is
 * pinned to their own regardless of what they ask for — the narrowing happens in
 * the query, not in the route, so a rep cannot widen it with `?repId=`.
 */
export async function GET(request: Request) {
  const authorized = await requireCapability("reports", "view");
  if (!authorized.ok) return authorized.response;

  const { actor } = authorized;
  const params = new URL(request.url).searchParams;

  const filters: ReportFilters = {
    period: params.get("period"),
    // Own-scoped callers are overwritten, not merely defaulted.
    repId: actor.scope === "own" ? actor.userId : params.get("repId"),
    status: params.get("status"),
    product: params.get("product"),
  };

  // TODO(A7): translate `filters` into the reporting query and aggregate. The
  // query MUST apply `filters.repId` whenever `actor.scope` is "own" — that is
  // the only thing keeping a rep out of the rest of the team's numbers here.
  const response: ReportResponse = {
    filters,
    scope: actor.scope,
    rows: [],
    totals: { netTotal: 0, marginPct: null, count: 0 },
  };

  return NextResponse.json(response);
}

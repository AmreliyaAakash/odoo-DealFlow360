import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

/** STRUCTURE ONLY — aggregation queries not implemented. */

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
  rows: ReportRow[];
  totals: { netTotal: number; marginPct: number | null; count: number };
};

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const filters: ReportFilters = {
    period: params.get("period"),
    repId: params.get("repId"),
    status: params.get("status"),
    product: params.get("product"),
  };

  // TODO(A7): translate `filters` into the reporting query and aggregate.
  const response: ReportResponse = {
    filters,
    rows: [],
    totals: { netTotal: 0, marginPct: null, count: 0 },
  };

  return NextResponse.json(response);
}

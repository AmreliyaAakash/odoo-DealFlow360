import { clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";
import { formatCurrency } from "@/lib/quotations";
import { statusLabel } from "@/lib/status";
import { parseFilters, periodLabel, runReport, type ReportResult } from "./query";
import { renderReportHtml } from "./report-html";

/**
 * A7 — reporting.
 *
 * GET /api/reports?period=&repId=&status=&product=&format=
 *
 *   format=json  (default) rows and totals for the table on screen
 *   format=xlsx            a real spreadsheet, as a download
 *   format=html            a print-ready document; the browser turns it into
 *                          the PDF, which keeps the text vector rather than a
 *                          rasterised image of a page
 *
 * Every format runs the same query under the same guard, so an export can never
 * contain a row the caller could not see on screen — and never misses one they
 * could. Scope comes from the permission matrix: a rep is pinned to their own
 * rows no matter what `repId` they ask for.
 */

export type { ReportFilters, ReportRow, ReportTotals } from "./query";

const FORMATS = ["json", "xlsx", "html"] as const;
type Format = (typeof FORMATS)[number];

function asFormat(value: string | null): Format {
  return FORMATS.includes(value as Format) ? (value as Format) : "json";
}

export async function GET(request: Request) {
  const authorized = await requireCapability("reports", "view");
  if (!authorized.ok) return authorized.response;

  const { actor } = authorized;
  const params = new URL(request.url).searchParams;

  const result = await runReport(parseFilters(params), actor);

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  switch (asFormat(params.get("format"))) {
    case "xlsx":
      return spreadsheet(result);
    case "html":
      return printable(result, actor.userId, actor.role);
    default:
      return NextResponse.json(result);
  }
}

/* ------------------------------------------------------------------ *
 * Spreadsheet
 * ------------------------------------------------------------------ */

/**
 * Numbers stay numbers. Writing "₹12,34,567" into a cell would make the file
 * look right and be useless — the recipient could not sum a column — so the
 * currency lives in the cell's number format instead.
 */
const INR_FORMAT = '"₹"#,##0';
const PCT_FORMAT = "0.0%";
const DATE_FORMAT = "dd mmm yyyy";

/**
 * A Date written straight into a cell comes back formatted `m/d/yy` whatever
 * `z` says — SheetJS stamps its own date format on write. Writing the Excel
 * serial as a number keeps the cell a real date to sort and filter on while
 * letting the format stick. Built from the calendar day rather than the
 * timestamp so a quotation dated the 31st does not read back as the 30th west
 * of UTC.
 */
function excelSerial(date: Date): number {
  return (
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000 +
    25_569
  );
}

async function spreadsheet(result: ReportResult): Promise<Response> {
  const XLSX = await import("xlsx");

  const header = [
    "Quotation",
    "Customer",
    "Rep",
    "Status",
    "Max discount %",
    "Subtotal",
    "Discount",
    "Net",
    "Cost",
    "Margin",
    "Margin %",
    "Created",
  ];

  const body = result.rows.map((row) => [
    row.reference ?? row.quotationId,
    row.customer ?? "",
    row.rep ?? "",
    statusLabel(row.status ?? "draft"),
    row.maxDiscountPct / 100,
    row.subtotal,
    row.discountTotal,
    row.netTotal,
    row.costTotal,
    row.marginTotal,
    row.marginPct,
    row.createdAt ? excelSerial(new Date(row.createdAt)) : null,
  ]);

  const totals = [
    "Total",
    "",
    "",
    "",
    null,
    result.totals.subtotal,
    result.totals.discountTotal,
    result.totals.netTotal,
    result.totals.costTotal,
    result.totals.marginTotal,
    result.totals.marginPct,
    null,
  ];

  const sheet = XLSX.utils.aoa_to_sheet([header, ...body, [], totals]);

  // Column widths, so nothing arrives as ####.
  sheet["!cols"] = [
    { wch: 14 }, { wch: 24 }, { wch: 20 }, { wch: 16 }, { wch: 13 },
    { wch: 14 }, { wch: 13 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
    { wch: 10 }, { wch: 13 },
  ];
  applyFormats(XLSX, sheet, body.length);

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Quotations");

  const buffer = XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename(result, "xlsx")}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Number formats per column, applied to the data rows and the totals row. */
function applyFormats(
  XLSX: typeof import("xlsx"),
  sheet: import("xlsx").WorkSheet,
  dataRows: number,
) {
  // Header is row 0; data is 1..dataRows; the totals row sits one blank below.
  const rows = [
    ...Array.from({ length: dataRows }, (_, i) => i + 1),
    dataRows + 2,
  ];

  const currencyColumns = [5, 6, 7, 8, 9];
  const percentColumns = [4, 10];

  for (const r of rows) {
    for (const c of currencyColumns) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.t === "n") cell.z = INR_FORMAT;
    }
    for (const c of percentColumns) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.t === "n") cell.z = PCT_FORMAT;
    }
    const date = sheet[XLSX.utils.encode_cell({ r, c: 11 })];
    if (date && date.t === "n") date.z = DATE_FORMAT;
  }
}

/* ------------------------------------------------------------------ *
 * Printable document
 * ------------------------------------------------------------------ */

async function printable(
  result: ReportResult,
  userId: string,
  role: string,
): Promise<Response> {
  let generatedBy = userId;
  try {
    const user = await (await clerkClient()).users.getUser(userId);
    generatedBy =
      [user.firstName, user.lastName].filter(Boolean).join(" ") ||
      user.emailAddresses[0]?.emailAddress ||
      userId;
  } catch {
    // The report is still worth producing without a name on it.
  }

  return new Response(renderReportHtml(result, { generatedBy, role }), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/* ------------------------------------------------------------------ */

function filename(result: ReportResult, extension: string): string {
  const period = periodLabel(result.filters.period)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return `dealflow360-report-${period}.${extension}`;
}

/** Re-exported so the client can label a total without duplicating the format. */
export { formatCurrency };

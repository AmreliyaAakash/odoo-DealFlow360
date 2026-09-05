"use client";

import type { ReportRow } from "@/app/api/reports/route";

/**
 * A7 — STRUCTURE ONLY.
 *
 * `xlsx` and `jspdf` are imported lazily so neither lands in the initial bundle;
 * both are browser-only.
 */

const COLUMNS: { key: keyof ReportRow; label: string }[] = [
  { key: "reference", label: "Quotation" },
  { key: "customer", label: "Customer" },
  { key: "rep", label: "Rep" },
  { key: "status", label: "Status" },
  { key: "netTotal", label: "Net" },
  { key: "marginPct", label: "Margin" },
  { key: "createdAt", label: "Created" },
];

export async function exportReportToXls(rows: ReportRow[], filename = "report.xlsx") {
  const XLSX = await import("xlsx");

  const sheet = XLSX.utils.json_to_sheet(
    rows.map((row) =>
      Object.fromEntries(COLUMNS.map((column) => [column.label, row[column.key]])),
    ),
  );
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Report");

  XLSX.writeFile(book, filename);
}

export async function exportReportToPdf(rows: ReportRow[], filename = "report.pdf") {
  const { jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");

  const doc = new jsPDF({ orientation: "landscape" });

  autoTable(doc, {
    head: [COLUMNS.map((column) => column.label)],
    body: rows.map((row) => COLUMNS.map((column) => String(row[column.key] ?? ""))),
  });

  doc.save(filename);
}

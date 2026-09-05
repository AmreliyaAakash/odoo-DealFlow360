import "server-only";
import { formatCurrency, formatNumber } from "@/lib/quotations";
import { statusLabel } from "@/lib/status";
import { periodLabel, type ReportResult } from "./query";

/**
 * The report as a print-ready HTML document.
 *
 * This is what becomes the PDF. Going through the browser's own print engine
 * rather than drawing the page with jsPDF keeps the text as real text —
 * selectable, searchable, and sharp at any zoom — and lets the layout be
 * ordinary CSS. An `@page` rule sets the paper up, and `thead` repeats on every
 * sheet so a long report stays readable after the first page.
 */

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatPct(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

/** Thin margins get a warning colour, the same threshold the desk uses. */
function marginClass(value: number | null): string {
  if (value === null) return "";
  if (value < 0) return "neg";
  if (value < 0.15) return "thin";
  return "";
}

export function renderReportHtml(
  result: ReportResult,
  meta: { generatedBy: string; role: string },
): string {
  const { rows, totals, filters } = result;

  const applied = [
    ["Period", periodLabel(filters.period)],
    ["Rep", filters.repId ? rows[0]?.rep ?? filters.repId : "All"],
    ["Status", filters.status ? statusLabel(filters.status) : "All"],
    ["Product", filters.product ?? "All"],
  ];

  const body = rows
    .map(
      (row) => `
        <tr>
          <td class="ref">${escapeHtml(row.reference ?? row.quotationId.slice(0, 8))}</td>
          <td>${escapeHtml(row.customer ?? "—")}</td>
          <td>${escapeHtml(row.rep ?? "—")}</td>
          <td><span class="pill ${escapeHtml(row.status ?? "draft")}">${escapeHtml(
            statusLabel(row.status ?? "draft"),
          )}</span></td>
          <td class="num">${escapeHtml(formatNumber(row.maxDiscountPct))}%</td>
          <td class="num">${escapeHtml(formatCurrency(row.netTotal))}</td>
          <td class="num">${escapeHtml(formatCurrency(row.marginTotal))}</td>
          <td class="num ${marginClass(row.marginPct)}">${escapeHtml(
            formatPct(row.marginPct),
          )}</td>
          <td class="num date">${escapeHtml(formatDate(row.createdAt))}</td>
        </tr>`,
    )
    .join("");

  const empty = `
    <tr><td class="empty" colspan="9">No quotations match these filters.</td></tr>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>DealFlow360 report — ${escapeHtml(periodLabel(filters.period))}</title>
<style>
  /* Landscape: nine columns of figures do not fit a portrait page. */
  @page { size: A4 landscape; margin: 14mm 12mm; }

  :root {
    --ink: #18181b;
    --muted: #71717a;
    --line: #e4e4e7;
    --accent: #6366f1;
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    font: 11px/1.45 "Helvetica Neue", Helvetica, Arial, sans-serif;
    color: var(--ink);
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  header { display: flex; align-items: flex-start; gap: 16px; margin-bottom: 14px; }
  .mark {
    width: 26px; height: 26px; border-radius: 6px;
    background: var(--accent); color: #fff;
    font-weight: 700; font-size: 13px;
    display: flex; align-items: center; justify-content: center;
  }
  h1 { margin: 0; font-size: 15px; letter-spacing: -0.01em; }
  .sub { margin: 2px 0 0; color: var(--muted); font-size: 10px; }
  .meta { margin-left: auto; text-align: right; color: var(--muted); font-size: 10px; }

  .filters {
    display: flex; flex-wrap: wrap; gap: 6px;
    margin-bottom: 12px;
  }
  .chip {
    border: 1px solid var(--line); border-radius: 999px;
    padding: 3px 9px; font-size: 10px;
  }
  .chip b { font-weight: 600; }
  .chip span { color: var(--muted); }

  .cards { display: flex; gap: 8px; margin-bottom: 12px; }
  .card {
    flex: 1; border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px;
  }
  .card .label { color: var(--muted); font-size: 9px; text-transform: uppercase; letter-spacing: .04em; }
  .card .value { font-size: 14px; font-weight: 600; margin-top: 3px; font-variant-numeric: tabular-nums; }

  table { width: 100%; border-collapse: collapse; }
  /* Repeat the header on every printed sheet. */
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }

  th {
    text-align: left; font-size: 9px; font-weight: 600;
    text-transform: uppercase; letter-spacing: .04em; color: var(--muted);
    border-bottom: 1px solid var(--line); padding: 0 6px 5px;
  }
  td { padding: 5px 6px; border-bottom: 1px solid #f4f4f5; vertical-align: top; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  td.date { color: var(--muted); }
  td.ref { font-weight: 600; }
  td.thin { color: #b45309; }
  td.neg { color: #b91c1c; font-weight: 600; }
  td.empty { text-align: center; padding: 28px; color: var(--muted); }

  tfoot td {
    border-top: 1.5px solid var(--ink); border-bottom: none;
    font-weight: 700; padding-top: 7px;
  }

  .pill {
    display: inline-block; padding: 1px 7px; border-radius: 999px;
    font-size: 9px; background: #f4f4f5; color: #3f3f46; white-space: nowrap;
  }
  .pill.approved { background: #eef2ff; color: #4338ca; }
  .pill.won { background: #ecfdf5; color: #047857; }
  .pill.lost { background: #f4f4f5; color: #52525b; }
  .pill.rejected { background: #fef2f2; color: #b91c1c; }
  .pill.returned { background: #fff7ed; color: #c2410c; }
  .pill.pending_approval { background: #fffbeb; color: #b45309; }

  footer {
    margin-top: 14px; padding-top: 8px; border-top: 1px solid var(--line);
    color: var(--muted); font-size: 9px;
    display: flex; justify-content: space-between;
  }

  /* On screen the document sits on a grey ground; print drops that. */
  @media screen {
    body { background: #f4f4f5; padding: 24px; }
    .sheet { background: #fff; padding: 28px; max-width: 1100px; margin: 0 auto;
             border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,.12); }
    .print-hint {
      max-width: 1100px; margin: 0 auto 12px; font: 12px/1.5 system-ui, sans-serif;
      color: #3f3f46; display: flex; gap: 10px; align-items: center;
    }
    .print-hint button {
      font: inherit; font-weight: 600; cursor: pointer;
      background: #4f46e5; color: #fff; border: 0;
      border-radius: 7px; padding: 7px 13px;
    }
  }
  @media print { .print-hint { display: none; } .sheet { padding: 0; } }
</style>
</head>
<body>
  <div class="print-hint">
    <button type="button" onclick="window.print()">Save as PDF</button>
    <span>Choose “Save as PDF” as the destination. Landscape A4 is already set.</span>
  </div>

  <div class="sheet">
    <header>
      <div class="mark"><img src="/icon.png" style="width:22px;height:22px;object-fit:contain;filter:invert(1);" alt="Icon" /></div>
      <div>
        <h1>Quotation report</h1>
        <p class="sub">DealFlow360 · ${escapeHtml(periodLabel(filters.period))}</p>
      </div>
      <div class="meta">
        Generated ${escapeHtml(
          new Date().toLocaleString("en-IN", {
            day: "numeric",
            month: "short",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
          }),
        )}<br>
        by ${escapeHtml(meta.generatedBy)} (${escapeHtml(meta.role)})
      </div>
    </header>

    <div class="filters">
      ${applied
        .map(
          ([label, value]) =>
            `<span class="chip"><span>${escapeHtml(label)}:</span> <b>${escapeHtml(
              value,
            )}</b></span>`,
        )
        .join("")}
    </div>

    <div class="cards">
      <div class="card"><div class="label">Quotations</div><div class="value">${escapeHtml(
        formatNumber(totals.count),
      )}</div></div>
      <div class="card"><div class="label">Net value</div><div class="value">${escapeHtml(
        formatCurrency(totals.netTotal),
      )}</div></div>
      <div class="card"><div class="label">Discount given</div><div class="value">${escapeHtml(
        formatCurrency(totals.discountTotal),
      )}</div></div>
      <div class="card"><div class="label">Margin</div><div class="value">${escapeHtml(
        formatCurrency(totals.marginTotal),
      )}</div></div>
      <div class="card"><div class="label">Blended margin</div><div class="value">${escapeHtml(
        formatPct(totals.marginPct),
      )}</div></div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Quotation</th><th>Customer</th><th>Rep</th><th>Status</th>
          <th style="text-align:right">Disc.</th>
          <th style="text-align:right">Net</th>
          <th style="text-align:right">Margin</th>
          <th style="text-align:right">Margin %</th>
          <th style="text-align:right">Created</th>
        </tr>
      </thead>
      <tbody>${rows.length === 0 ? empty : body}</tbody>
      ${
        rows.length === 0
          ? ""
          : `<tfoot>
        <tr>
          <td colspan="5">Total — ${escapeHtml(formatNumber(totals.count))} quotations</td>
          <td class="num">${escapeHtml(formatCurrency(totals.netTotal))}</td>
          <td class="num">${escapeHtml(formatCurrency(totals.marginTotal))}</td>
          <td class="num">${escapeHtml(formatPct(totals.marginPct))}</td>
          <td></td>
        </tr>
      </tfoot>`
      }
    </table>

    <footer>
      <span>DealFlow360 — confidential</span>
      <span>Rows shown are limited to what this account may see.</span>
    </footer>
  </div>
</body>
</html>`;
}

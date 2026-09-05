import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { canWith, effectiveAccess, scopeWith } from "@/lib/permissions-server";
import { loadReportStats } from "@/lib/reports-stats-server";
import { Notice, PageHeader, Panel } from "@/components/dashboard/panel";
import { parseFilters, runReport } from "@/app/api/reports/query";
import { loadReportOptions } from "./options";
import { ReportsView } from "./reports-view";

/**
 * A7 — reporting with filters and exports.
 *
 * The scope is resolved here and handed down so the filter bar can tell the
 * truth about what it is filtering: a rep has no Rep dropdown, because there is
 * only ever one answer for them and the API would overwrite it anyway.
 */
/** Matches EMPTY_FILTERS in reports-view.tsx: the screen opens on last 90 days. */
const DEFAULT_QUERY = "period=last90";

export default async function ReportsPage() {
  const { userId, role } = await currentUser();
  if (!userId) redirect("/sign-in");

  const { access } = await effectiveAccess(userId, role);
  if (!canWith(access, "reports", "view")) redirect("/unauthorized");

  const scope = scopeWith(access, "reports");

  // The first result is fetched here rather than from a mount effect, so the
  // page arrives populated instead of empty-then-filled.
  const [options, initial, stats] = await Promise.all([
    loadReportOptions(scope),
    runReport(parseFilters(new URLSearchParams(DEFAULT_QUERY)), { userId, scope }),
    loadReportStats(scope, userId),
  ]);

  const caption =
    scope === "own"
      ? "Your quotations — filter and export"
      : scope === "team"
        ? "Your team's quotations — filter and export"
        : "Every quotation — filter and export";

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4">
      <PageHeader title="Reports" caption={caption} badge={role ?? undefined} />
      {stats.error ? <Notice tone="danger">{stats.error}</Notice> : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Quotes created"
          value={stats.quotesCreated.toLocaleString("en-IN")}
          hint="Last 90 days"
        />
        <Stat
          label="Avg approval time"
          value={
            stats.avgApprovalDays === null
              ? "—"
              : `${stats.avgApprovalDays} ${stats.avgApprovalDays === 1 ? "day" : "days"}`
          }
          hint={
            stats.approvalsMeasured === 0
              ? "No decisions in the window"
              : `Business days across ${stats.approvalsMeasured} decisions`
          }
        />
        <Stat
          label="Top upsold product"
          value={stats.topUpsoldProduct ?? "—"}
          hint={
            stats.topUpsoldCount === 0
              ? "No suggested product has landed yet"
              : `On ${stats.topUpsoldCount} quotes`
          }
        />
      </div>

      <ReportsView options={options} scope={scope} initial={initial} />
    </main>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <Panel className="p-3">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-xl font-semibold tabular-nums">{value}</p>
      <p className="text-[11px] text-muted-foreground">{hint}</p>
    </Panel>
  );
}

import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { canWith, effectiveAccess, scopeWith } from "@/lib/permissions-server";
import { PageHeader } from "@/components/dashboard/panel";
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
  const [options, initial] = await Promise.all([
    loadReportOptions(scope),
    runReport(parseFilters(new URLSearchParams(DEFAULT_QUERY)), { userId, scope }),
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
      <ReportsView options={options} scope={scope} initial={initial} />
    </main>
  );
}

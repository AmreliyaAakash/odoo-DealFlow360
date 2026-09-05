import { redirect } from "next/navigation";
import { currentUser, isApprover } from "@/lib/auth";
import { requireAnyModule } from "@/lib/page-guard";
import { Notice, PageHeader } from "@/components/dashboard/panel";
import { AnomalyHighlights } from "./anomaly-highlights";
import { ApprovalVolumeChart } from "./approval-volume-chart";
import { loadManagerDashboard } from "./data";
import { ManagerStatCards } from "./stat-cards";
import { PendingApprovalsTable } from "@/components/dashboard/pending-approvals-table";

/**
 * Sales manager / approver home.
 *
 * Three gates, each doing something the others cannot. `proxy.ts` keeps
 * non-approver roles off the URL; `isApprover` repeats that server-side rather
 * than trusting the proxy alone; and the module check below decides what is
 * actually on the page, so an approver whose `approvals` was revoked by an
 * override does not get a queue with live decision buttons on it.
 */
export default async function ManagerDashboardPage() {
  const { userId, role } = await currentUser();
  if (!userId) redirect("/sign-in");
  if (!isApprover(role)) redirect("/");

  const actor = await requireAnyModule(["approvals", "dealHealth"]);

  const seesQueue = actor.can("approvals", "view");
  const seesAnomalies = actor.can("dealHealth", "view");

  const data = await loadManagerDashboard(role);

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4">
      <PageHeader
        title="Approver dashboard"
        caption="Deals waiting on your desk, and where the risk sits"
        badge={role}
      />

      {data.loadError ? (
        <Notice>Could not load the approval queue: {data.loadError}</Notice>
      ) : null}

      <ManagerStatCards stats={data.stats} />

      {/* The volume chart is approvals data and the anomaly list is deal
          health. An approver granted one module and not the other sees only
          the half they hold, and it takes the full width rather than leaving
          a gap where the other used to be. */}
      {seesQueue || seesAnomalies ? (
        <div className="grid gap-4 xl:grid-cols-3">
          {seesQueue ? (
            <div className={seesAnomalies ? "xl:col-span-2" : "xl:col-span-3"}>
              <ApprovalVolumeChart data={data.volume} />
            </div>
          ) : null}
          {seesAnomalies ? (
            <div className={seesQueue ? undefined : "xl:col-span-3"}>
              <AnomalyHighlights reps={data.anomalies} />
            </div>
          ) : null}
        </div>
      ) : null}

      {seesQueue ? (
        <PendingApprovalsTable
          deals={data.pending}
          canDecide={actor.can("approvals", "write")}
        />
      ) : null}
    </main>
  );
}

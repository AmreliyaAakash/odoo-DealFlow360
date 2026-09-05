import { redirect } from "next/navigation";
import { currentUser, isApprover } from "@/lib/auth";
import { Notice, PageHeader } from "@/components/dashboard/panel";
import { AnomalyHighlights } from "./anomaly-highlights";
import { ApprovalVolumeChart } from "./approval-volume-chart";
import { loadManagerDashboard } from "./data";
import { ManagerStatCards } from "./stat-cards";
import { PendingApprovalsTable } from "@/components/dashboard/pending-approvals-table";

/** Sales manager / approver home. `proxy.ts` gates this to approver roles. */
export default async function ManagerDashboardPage() {
  const { userId, role } = await currentUser();
  if (!userId) redirect("/sign-in");
  if (!isApprover(role)) redirect("/");

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

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <ApprovalVolumeChart data={data.volume} />
        </div>
        <AnomalyHighlights reps={data.anomalies} />
      </div>

      <PendingApprovalsTable deals={data.pending} />
    </main>
  );
}

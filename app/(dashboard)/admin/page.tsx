import { Notice, PageHeader } from "@/components/dashboard/panel";
import { AuditLog } from "./audit-log";
import { loadAdminDashboard } from "./data";
import { DealVolumeChart } from "./deal-volume-chart";
import { requireAdmin } from "./guard";
import { QuickConfig } from "./quick-config";
import { AdminStatCards } from "./stat-cards";

/** A6 — admin home: what the system is configured with, and who changed it. */
export default async function AdminDashboardPage() {
  const role = await requireAdmin();
  const data = await loadAdminDashboard();

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4">
      <PageHeader
        title="Admin dashboard"
        caption="System configuration, company-wide volume and the change trail"
        badge={role}
      />

      {data.loadError ? (
        <Notice>Could not load admin data: {data.loadError}</Notice>
      ) : null}

      <AdminStatCards stats={data.stats} />

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <DealVolumeChart data={data.volume} />
        </div>
        <QuickConfig stats={data.stats} />
      </div>

      <AuditLog initial={data.audit} />
    </main>
  );
}

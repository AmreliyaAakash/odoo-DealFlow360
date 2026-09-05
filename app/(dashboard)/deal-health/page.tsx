import { redirect } from "next/navigation";
import { HeartbeatIcon } from "@phosphor-icons/react/dist/ssr";
import { currentUser } from "@/lib/auth";
import { loadDealHealth } from "@/lib/deal-health-server";
import { canWith, effectiveAccess, scopeWith } from "@/lib/permissions-server";
import { Notice, PageHeader, Panel, PanelHeader } from "@/components/dashboard/panel";
import { DealHealthTable } from "./deal-health-table";

/** B9 — open quotations, seeded server-side then kept fresh by realtime. */
export default async function DealHealthPage() {
  const { userId, role } = await currentUser();
  if (!userId) {
    redirect("/sign-in");
  }

  // The route guard lets every staff role in; the matrix is what an account's
  // own override can narrow, so it is checked here too.
  const { access } = await effectiveAccess(userId, role);
  if (!canWith(access, "dealHealth", "view")) redirect("/unauthorized");

  // A rep watches their own deals; a manager watches the desk. The same scope
  // rule the pipeline applies, so the two screens cannot disagree about what
  // "open" means for this account.
  const scope = scopeWith(access, "dealHealth");
  const data = await loadDealHealth(scope === "own" ? userId : null);

  const flagged = data.quotations.length;

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4">
      {data.error ? (
        <Notice tone="danger">Could not load quotations: {data.error}</Notice>
      ) : null}

      <DealHealthTable
        initial={data.quotations}
        baselines={data.baselines}
        approvalBreakdown={data.approvalBreakdown}
        canAct={canWith(access, "dealHealth", "write")}
        role={role}
      />
    </main>
  );
}

import { redirect } from "next/navigation";
import { HeartbeatIcon } from "@phosphor-icons/react/dist/ssr";
import { currentUser } from "@/lib/auth";
import type { DealHealthQuotation } from "@/lib/business-logic";
import { canWith, effectiveAccess } from "@/lib/permissions-server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
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

  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from("quotations")
    .select(
      "id, reference, status, net_total, margin_total, max_discount_pct, updated_at, submitted_at",
    )
    .in("status", ["draft", "pending_approval", "approved"])
    .order("updated_at", { ascending: false })
    .limit(100)
    .returns<DealHealthQuotation[]>();

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4">
      <PageHeader
        title="Deal health"
        caption="Live view of open quotations"
        badge="Realtime"
      />

      {error ? <Notice>Could not load quotations: {error.message}</Notice> : null}

      <Panel delay={80}>
        <PanelHeader
          icon={HeartbeatIcon}
          title="Open deals"
          caption="Rows badge themselves as health signals trip"
          href="/quotations"
        />
        <div className="mt-3">
          <DealHealthTable initial={data ?? []} />
        </div>
      </Panel>
    </main>
  );
}

import { auth } from "@clerk/nextjs/server";
import { currentRole } from "@/lib/auth";
import { effectiveAccess } from "@/lib/permissions-server";
import { AssistantWidget } from "@/components/assistant/assistant-widget";
import { DashboardSidebar } from "./dashboard-sidebar";
import { PermissionsProvider } from "./permissions-provider";
import { loadWatchlist } from "./sidebar-data";

/**
 * B1 — internal workspace shell. The sidebar is the only navigation; there is
 * no top bar, so each page owns its own header.
 *
 * Access is resolved once here and handed to the client, so the sidebar and any
 * conditional control below it agree with what the API would actually allow —
 * including per-account overrides, which the static matrix knows nothing about.
 */
export default async function DashboardLayout({ children }: LayoutProps<"/">) {
  const { userId } = await auth();
  const role = await currentRole();

  const permissions = await effectiveAccess(userId, role);

  // Only the rep workspace renders the rail, so skip the query for everyone else.
  const watchlist =
    userId && (role === null || role === "rep") ? await loadWatchlist(userId) : [];

  return (
    <PermissionsProvider value={permissions}>
      <div className="flex min-h-screen flex-1 gap-4 bg-muted/40 p-4">
        <DashboardSidebar role={role} watchlist={watchlist} />
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
      {/* Inside the provider, so the panel's quick questions and the tools it
          calls are working from the same resolved access. */}
      <AssistantWidget />
    </PermissionsProvider>
  );
}

import { auth } from "@clerk/nextjs/server";
import { currentRole } from "@/lib/auth";
import { DashboardSidebar } from "./dashboard-sidebar";
import { loadWatchlist } from "./sidebar-data";

/**
 * B1 — internal workspace shell. The sidebar is the only navigation; there is
 * no top bar, so each page owns its own header.
 */
export default async function DashboardLayout({ children }: LayoutProps<"/">) {
  const { userId } = await auth();
  const role = await currentRole();
  const watchlist = userId ? await loadWatchlist(userId) : [];

  return (
    <div className="flex min-h-full flex-1 gap-4 bg-muted/40 p-4">
      <DashboardSidebar role={role} watchlist={watchlist} />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

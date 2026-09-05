import { PageHeader } from "@/components/dashboard/panel";
import { ReportsView } from "./reports-view";

/** A7 — reporting with filters and exports. */
export default function ReportsPage() {
  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4">
      <PageHeader
        title="Reports"
        caption="Filter quotations and export the result"
        badge="XLS · PDF"
      />
      <ReportsView />
    </main>
  );
}

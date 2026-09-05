import { currentRole } from "@/lib/auth";
import { PageHeader } from "@/components/dashboard/panel";
import { ApprovalQueue, type PendingQuotation } from "./approval-queue";

/**
 * B4 — approval queue.
 *
 * STRUCTURE ONLY: the query below is not implemented; `proxy.ts` already limits
 * this route to the manager, finance and admin roles.
 */
export default async function ApprovalsPage() {
  const role = await currentRole();

  // TODO(B4): select quotations where `required_approvals` contains `role` and
  // status is 'pending_approval', joining lines that violate a discount rule.
  const pending: PendingQuotation[] = [];

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4">
      <PageHeader
        title="Approvals"
        caption={`Quotations waiting on ${role ?? "your"} sign-off`}
        badge={role ?? undefined}
      />
      <ApprovalQueue quotations={pending} />
    </main>
  );
}

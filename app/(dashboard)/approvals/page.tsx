import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { loadPendingApprovals } from "@/lib/approvals-server";
import { canWith, effectiveAccess } from "@/lib/permissions-server";
import { Notice, PageHeader } from "@/components/dashboard/panel";
import { PendingApprovalsTable } from "@/components/dashboard/pending-approvals-table";

/**
 * B4 — the approval queue.
 *
 * `proxy.ts` gates the route to the four staff roles; the queue then narrows by
 * level, so a manager and a finance approver standing on the same URL see
 * different deals, and a rep sees their own deals in review with no controls.
 *
 * Same loader and same table as the manager dashboard's queue — a deal waiting
 * on you must not appear on one screen and be missing from the other.
 */
export default async function ApprovalsPage() {
  const { userId, role } = await currentUser();
  if (!userId) redirect("/sign-in");

  const { access } = await effectiveAccess(userId, role);
  if (!canWith(access, "approvals", "view")) redirect("/unauthorized");

  const canDecide = canWith(access, "approvals", "write");
  const { pending, loadError } = await loadPendingApprovals(role);

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4">
      <PageHeader
        title="Approvals"
        caption={
          canDecide
            ? role === "admin"
              ? "Every quotation awaiting a decision, at any level"
              : `Quotations waiting on ${role} sign-off`
            : "Your quotations currently with the desk"
        }
        badge={role ?? undefined}
      />

      {loadError ? <Notice tone="danger">{loadError}</Notice> : null}

      <PendingApprovalsTable
        deals={pending}
        title={canDecide ? "Waiting on you" : "In review"}
        delay={80}
        canDecide={canDecide}
        emptyText={
          canDecide ? "Nothing is waiting on you." : "None of your deals are in review."
        }
      />
    </main>
  );
}

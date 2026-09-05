import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { NegotiationThread } from "./negotiation-thread";

/** B8 — customer negotiation view. STRUCTURE ONLY: the quote is not fetched yet. */
export default async function PortalQuotePage({
  params,
}: PageProps<"/portal/[quoteId]">) {
  const { userId } = await auth();
  if (!userId) {
    redirect("/portal");
  }

  const { quoteId } = await params;

  // TODO(B8): load the quotation and its lines; RLS already limits a portal user
  // to quotations belonging to their own `customers` row.

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-6">
      <header>
        <h1 className="text-lg font-semibold">Your quotation</h1>
        <p className="text-sm text-muted-foreground">{quoteId}</p>
      </header>

      {/* TODO(B8): render the priced lines and an accept / request-change action. */}

      <NegotiationThread quoteId={quoteId} />
    </main>
  );
}

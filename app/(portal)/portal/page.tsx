import Link from "next/link";
import { SignIn } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { CaretRightIcon, ChatCircleIcon } from "@phosphor-icons/react/dist/ssr";
import { BrandMark } from "@/components/brand-mark";
import { PORTAL_STAGE_LABELS } from "@/lib/business-logic";
import { formatCurrency } from "@/lib/quotations";
import { portalIdentity } from "./guard";
import { loadPortalQuotes, type PortalQuoteSummary } from "./quote-list";
import { PortalCard, PortalShell, Stat, StagePill, portalDate } from "./shell";

/**
 * Portal entry point. Signed-out visitors get an email-link-only sign-in; signed-in
 * ones see every quotation on their account, or are sent straight to it when
 * there is only one.
 */
export default async function PortalPage() {
  const { userId } = await auth();

  if (!userId) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-6">
        <div className="mb-6 flex flex-col items-center gap-3">
          <BrandMark size="lg" orientation="column" priority />
          <p className="text-xs text-muted-foreground font-medium">Customer Portal Access</p>
        </div>
        <SignIn
          routing="hash"
          appearance={{
            elements: {
              // Email link is the only supported factor for portal customers —
              // hide every alternative the Clerk instance might still offer.
              socialButtonsRoot: "hidden",
              dividerRow: "hidden",
              alternativeMethods: "hidden",
              footerAction: "hidden",
              formFieldRow__password: "hidden",
            },
          }}
        />
      </main>
    );
  }

  // Resolves the Clerk user to their customer row, and refuses anyone who is
  // not a portal customer.
  const access = await portalIdentity();

  if (!access.ok) {
    return (
      <PortalNotice
        title={
          access.reason === "notCustomer"
            ? "This account is not a portal account"
            : "No portal account linked"
        }
      />
    );
  }

  const { quotes, customerName, error } = await loadPortalQuotes(access.identity);

  if (error) {
    // The reason goes to the log; the customer gets a sentence they can act on.
    console.error("[portal] could not list quotations:", error);
    return <PortalNotice title="We could not load your quotations" />;
  }

  if (quotes.length === 0) {
    return <PortalNotice title="No quotation is ready for you yet" />;
  }

  // One quote is not a list worth reading — go straight to it, which is what
  // this page did for every case before there was anywhere else to go.
  if (quotes.length === 1) {
    redirect(`/portal/${quotes[0].id}`);
  }

  return <QuoteIndex quotes={quotes} customerName={customerName} />;
}

/**
 * Every quotation this customer has, newest first.
 *
 * Deliberately a summary and not a second quote view: the stage, the value and
 * whether anyone is waiting on a reply are what decide which one you open. The
 * numbers a customer reads carefully belong on the quote itself.
 */
function QuoteIndex({
  quotes,
  customerName,
}: {
  quotes: PortalQuoteSummary[];
  customerName: string;
}) {
  const open = quotes.filter((quote) => !quote.closedLost);
  const closed = quotes.filter((quote) => quote.closedLost);
  const awaiting = open.filter((quote) => quote.status === "approved");
  const openValue = open.reduce((sum, quote) => sum + quote.netTotal, 0);

  return (
    <PortalShell customerName={customerName} crumbs={[{ label: "Quotations" }]}>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Your quotations</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Everything your account manager has sent to {customerName}, newest first.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat
          label="Open"
          value={String(open.length)}
          hint={open.length === 1 ? "quotation in progress" : "quotations in progress"}
        />
        <Stat
          label="Awaiting your confirmation"
          value={String(awaiting.length)}
          hint={awaiting.length > 0 ? "Cleared by our desk and ready to accept" : "Nothing waiting on you"}
          tone={awaiting.length > 0 ? "warning" : "muted"}
        />
        <Stat label="Open value" value={formatCurrency(openValue)} hint="Across open quotations" />
      </div>

      <QuoteTable
        title="Open"
        caption="Quotations you can still act on"
        quotes={open}
      />
      {closed.length > 0 ? (
        <QuoteTable title="Closed" caption="Kept for your records" quotes={closed} />
      ) : null}
    </PortalShell>
  );
}

function QuoteTable({
  title,
  caption,
  quotes,
}: {
  title: string;
  caption: string;
  quotes: PortalQuoteSummary[];
}) {
  if (quotes.length === 0) return null;

  return (
    <PortalCard title={title} caption={caption} bodyClassName="p-0">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs" style={{ minWidth: "40rem" }}>
          <thead>
            <tr className="bg-muted/50 text-left text-[10px] tracking-wider text-muted-foreground uppercase">
              <th className="px-5 py-2.5 font-medium">Quotation</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
              <th className="w-20 px-3 py-2.5 text-right font-medium">Items</th>
              <th className="w-36 px-3 py-2.5 text-right font-medium">Total</th>
              <th className="w-32 px-3 py-2.5 font-medium">Issued</th>
              <th className="w-32 px-3 py-2.5 font-medium">Valid until</th>
              <th className="w-10 px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {quotes.map((quote) => {
              const awaiting = !quote.closedLost && quote.status === "approved";
              return (
                <tr key={quote.id} className="group border-t border-border/60 transition-colors hover:bg-sky-500/5">
                  <td className="px-5 py-3.5">
                    <Link href={`/portal/${quote.id}`} className="block font-semibold text-foreground">
                      {quote.reference}
                    </Link>
                    {quote.messageCount > 0 ? (
                      <span className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                        <ChatCircleIcon size={11} />
                        {quote.messageCount} message{quote.messageCount === 1 ? "" : "s"}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-3.5">
                    <StagePill
                      label={
                        quote.closedLost
                          ? "Closed"
                          : awaiting
                            ? "Ready to confirm"
                            : PORTAL_STAGE_LABELS[quote.stage]
                      }
                      tone={
                        quote.closedLost
                          ? "closed"
                          : quote.status === "won"
                            ? "done"
                            : "open"
                      }
                    />
                  </td>
                  <td className="px-3 py-3.5 text-right tabular-nums">{quote.lineCount}</td>
                  <td className="px-3 py-3.5 text-right font-semibold tabular-nums">
                    {formatCurrency(quote.netTotal)}
                  </td>
                  <td className="px-3 py-3.5 text-muted-foreground">{portalDate(quote.createdAt) ?? "—"}</td>
                  <td className="px-3 py-3.5 text-muted-foreground">{portalDate(quote.validUntil) ?? "—"}</td>
                  <td className="px-3 py-3.5 text-right">
                    <Link
                      href={`/portal/${quote.id}`}
                      aria-label={`Open ${quote.reference}`}
                      className="inline-flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors group-hover:bg-sky-500/10 group-hover:text-sky-700 dark:group-hover:text-sky-400"
                    >
                      <CaretRightIcon size={14} />
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </PortalCard>
  );
}

function PortalNotice({ title }: { title: string }) {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="max-w-sm text-center flex flex-col items-center">
        <div className="mb-5 flex flex-col items-center gap-2">
          <BrandMark size="md" orientation="column" />
        </div>
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Please contact your account manager if you believe this is a mistake.
        </p>
      </div>
    </main>
  );
}

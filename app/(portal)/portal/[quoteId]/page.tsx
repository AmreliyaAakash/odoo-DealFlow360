import { UserButton } from "@clerk/nextjs";
import { BrandMark } from "@/components/brand-mark";
import { SealCheckIcon } from "@phosphor-icons/react/dist/ssr";
import { PORTAL_STAGE_LABELS } from "@/lib/business-logic";
import { formatCurrency } from "@/lib/quotations";
import { requirePortalIdentity } from "../guard";
import { loadPortalQuote } from "./data";
import { QuoteStepper } from "./quote-stepper";
import { ConfirmBar } from "./confirm-bar";
import { QuoteView } from "./quote-view";

/**
 * B8 — the customer's view of one quotation. Standalone: no dashboard sidebar,
 * sky accent, and nothing internal on the page — no cost, margin, risk score or
 * approval state, all of which RLS would hand over but the customer must not see.
 */
export default async function PortalQuotePage({
  params,
}: PageProps<"/portal/[quoteId]">) {
  // Redirects a signed-out visitor; anything else is reported on the page.
  const access = await requirePortalIdentity();
  if (!access.ok) {
    return <PortalNotice reason={access.reason === "notCustomer" ? "notFound" : "unlinked"} />;
  }

  const { quoteId } = await params;
  const result = await loadPortalQuote(quoteId, access.identity);

  if (!result.ok) {
    // The detail goes to the server log, never to the page. This is the one
    // screen an outside customer sees, and `message` is only ever set for
    // reason "error", where it is the raw Postgres string — rendering it told
    // them things like `column customers_1.phone does not exist`, which names
    // internal tables and columns to someone who should never learn them.
    if (result.message) {
      console.error(`[portal] quotation ${quoteId} failed to load:`, result.message);
    }

    return <PortalNotice reason={result.reason} />;
  }

  const { quote } = result;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-center gap-3">
        <BrandMark size="md" priority />
        <div className="min-w-0 pl-3 border-l border-border">
          <p className="text-xs font-semibold text-foreground">
            Customer Portal
          </p>
          <p className="text-[11px] text-muted-foreground">
            {quote.customerName}
          </p>
        </div>
        <div className="ml-auto">
          <UserButton />
        </div>
      </header>

      {/* Hero: reference, value and where the quote has got to. */}
      <section className="rounded-2xl bg-card p-5 ring-1 ring-foreground/10 sm:p-6">
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0">
            <p className="text-[11px] tracking-wide text-muted-foreground uppercase">
              Quotation
            </p>
            <h1 className="text-lg font-semibold tracking-tight">
              {quote.reference}
            </h1>
          </div>

          <div className="ml-auto text-right">
            <p className="text-[11px] tracking-wide text-muted-foreground uppercase">
              Total
            </p>
            <p className="text-2xl font-semibold tracking-tight tabular-nums">
              {formatCurrency(quote.netTotal)}
            </p>
          </div>
        </div>

        {quote.closedLost ? (
          <p className="mt-4 rounded-xl bg-red-500/10 p-3 text-xs text-red-700 ring-1 ring-red-500/30 dark:text-red-400">
            This quotation is closed and can no longer be changed. Speak to your
            account manager if you would like a new one.
          </p>
        ) : (
          <p className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <SealCheckIcon size={14} className="text-sky-500" />
            Currently
            <span className="font-medium text-sky-600 dark:text-sky-400">
              {PORTAL_STAGE_LABELS[quote.stage]}
            </span>
            {quote.validUntil ? (
              <span className="text-muted-foreground">
                · valid until{" "}
                {new Date(quote.validUntil).toLocaleDateString("en-IN", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </span>
            ) : null}
          </p>
        )}

        <div className="mt-6">
          <QuoteStepper stage={quote.stage} closedLost={quote.closedLost} />
        </div>
      </section>

      {/* Above the lines: the customer should see what they can do before they
          finish reading what they are being asked to pay. */}
      {quote.closedLost ? null : <ConfirmBar quote={quote} />}

      <QuoteView quote={quote} />
    </main>
  );
}

const NOTICES: Record<string, { title: string; body: string }> = {
  unlinked: {
    title: "No portal account linked",
    body: "Your sign-in is not connected to a customer account yet. Please contact your account manager.",
  },
  notFound: {
    title: "Quotation not available",
    body: "This quotation does not exist, or it is not associated with your account.",
  },
  notReady: {
    title: "Not ready yet",
    body: "Your account manager is still preparing this quotation. You will be able to see it once it has been sent.",
  },
  error: {
    title: "Something went wrong",
    body: "We could not load your quotation. Please try again in a moment.",
  },
};

/**
 * Takes no detail string on purpose — see the call site. Whatever went wrong is
 * the desk's problem to read in the log, not the customer's to read on the page.
 */
function PortalNotice({
  reason,
}: {
  reason: "notFound" | "notReady" | "error" | "unlinked";
}) {
  const notice = NOTICES[reason];

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="max-w-sm rounded-2xl bg-card p-6 text-center ring-1 ring-foreground/10">
        <h1 className="text-base font-semibold">{notice.title}</h1>
        <p className="mt-2 text-xs text-muted-foreground">{notice.body}</p>
      </div>
    </main>
  );
}

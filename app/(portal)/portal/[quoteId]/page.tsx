import { CalendarBlankIcon, ReceiptIcon } from "@phosphor-icons/react/dist/ssr";
import { PORTAL_STAGE_LABELS } from "@/lib/business-logic";
import { formatCurrency, formatPercent } from "@/lib/quotations";
import { requirePortalIdentity } from "../guard";
import { loadPortalQuotes } from "../quote-list";
import {
  PortalCard,
  PortalShell,
  Stat,
  StagePill,
  daysUntil,
  portalDate,
} from "../shell";
import { loadPortalQuote } from "./data";
import { QuoteStepper } from "./quote-stepper";
import { QuoteView } from "./quote-view";

/**
 * B8 — the customer's view of one quotation.
 *
 * Nothing internal on the page — no cost, margin, risk score or approval
 * state, all of which RLS would hand over but the customer must not see.
 *
 * Laid out the way a purchasing manager reads a supplier's document: what it
 * is and what it costs at the top, where it has got to, then the decision they
 * are being asked to make, then the detail, with the conversation beside it
 * throughout. Every figure the page shows is one the desk sees too.
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

  // Decides whether the breadcrumb offers a way back: the list redirects
  // straight through when there is only one quotation to list.
  const { quotes } = await loadPortalQuotes(access.identity);
  const hasOthers = quotes.length > 1;

  const validUntil = portalDate(quote.validUntil);
  const daysLeft = daysUntil(quote.validUntil);
  const discountPct =
    quote.subtotal > 0 ? quote.discountTotal / quote.subtotal : 0;

  const stage = quote.closedLost
    ? { label: "Closed", tone: "closed" as const }
    : quote.settled
      ? { label: PORTAL_STAGE_LABELS[quote.stage], tone: "done" as const }
      : { label: PORTAL_STAGE_LABELS[quote.stage], tone: "open" as const };

  return (
    <PortalShell
      customerName={quote.customerName}
      crumbs={[
        { label: "Quotations", href: hasOthers ? "/portal" : undefined },
        { label: quote.reference },
      ]}
    >
      {/* Page header: what this is, what it costs, and where it stands. */}
      <div className="flex flex-wrap items-end gap-6">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">
              Quotation {quote.reference}
            </h1>
            <StagePill label={stage.label} tone={stage.tone} />
          </div>
          <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <ReceiptIcon size={13} />
              Prepared for {quote.customerName}
            </span>
            {validUntil ? (
              <span className="flex items-center gap-1.5">
                <CalendarBlankIcon size={13} />
                Valid until {validUntil}
              </span>
            ) : null}
          </p>
        </div>

        <div className="rounded-2xl bg-foreground px-5 py-4 text-background shadow-sm">
          <p className="text-[11px] tracking-wide uppercase opacity-70">Total payable</p>
          <p className="mt-0.5 text-3xl font-semibold tracking-tight tabular-nums">
            {formatCurrency(quote.netTotal)}
          </p>
          <p className="mt-0.5 text-[11px] opacity-70">
            Inclusive of all line discounts
          </p>
        </div>
      </div>

      {/* The figures a reader checks before anything else. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Items"
          value={String(quote.lines.length)}
          hint={quote.lines.length === 1 ? "line on this quotation" : "lines on this quotation"}
        />
        <Stat label="Subtotal" value={formatCurrency(quote.subtotal)} hint="Before discounts" />
        <Stat
          label="Discount"
          value={quote.discountTotal > 0 ? `− ${formatCurrency(quote.discountTotal)}` : "—"}
          hint={quote.discountTotal > 0 ? `${formatPercent(discountPct)} of subtotal` : "No discount applied"}
          tone={quote.discountTotal > 0 ? "positive" : "muted"}
        />
        <Stat
          label="Validity"
          value={
            quote.closedLost
              ? "Closed"
              : daysLeft === null
                ? "—"
                : daysLeft < 0
                  ? "Expired"
                  : daysLeft === 0
                    ? "Today"
                    : `${daysLeft} day${daysLeft === 1 ? "" : "s"}`
          }
          hint={validUntil ? `Until ${validUntil}` : undefined}
          tone={
            quote.closedLost
              ? "muted"
              : daysLeft !== null && daysLeft <= 7
                ? "warning"
                : undefined
          }
        />
      </div>

      <PortalCard
        title="Progress"
        caption={
          quote.closedLost
            ? "This quotation is closed and will not move further."
            : `Currently ${PORTAL_STAGE_LABELS[quote.stage].toLowerCase()}`
        }
      >
        <QuoteStepper stage={quote.stage} closedLost={quote.closedLost} />
      </PortalCard>

      <QuoteView quote={quote} />
    </PortalShell>
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

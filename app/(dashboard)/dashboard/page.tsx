import Link from "next/link";
import {
  ChatCircleIcon,
  CheckCircleIcon,
  ClockIcon,
  FileTextIcon,
  PaperPlaneTiltIcon,
  PulseIcon,
  TrophyIcon,
} from "@phosphor-icons/react/dist/ssr";
import { loadOverview, type ActivityKind } from "@/lib/dashboard-server";
import { requireModule } from "@/lib/page-guard";
import { formatCurrency } from "@/lib/quotations";
import { relativeTime } from "@/lib/dates";
import { Notice, PageHeader, Panel, PanelHeader } from "@/components/dashboard/panel";

/**
 * Screen 2 — the shared dashboard.
 *
 * One route for every role, narrowed by the viewer's own scope rather than by
 * their title. That is what makes the three figures comparable: a manager and a
 * rep looking at "Pending approvals" are looking at the same definition, over
 * different sets of deals.
 */
export default async function DashboardPage() {
  const actor = await requireModule("quotationBuilder");
  const overview = await loadOverview(actor.userId, actor.scope);

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4">
      <PageHeader
        title="Dashboard"
        caption={
          actor.scope === "own"
            ? "Your pipeline at a glance"
            : actor.scope === "team"
              ? "Your team's pipeline at a glance"
              : "The whole desk at a glance"
        }
        badge={actor.role ?? undefined}
      />

      {overview.error ? <Notice tone="danger">{overview.error}</Notice> : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard
          href="/quotations"
          icon={FileTextIcon}
          label="Open quotations"
          value={overview.openQuotations}
          hint={`${formatCurrency(overview.openValue)} in play`}
          tone="indigo"
        />
        <SummaryCard
          href="/approvals"
          icon={ClockIcon}
          label="Pending approvals"
          value={overview.pendingApprovals}
          hint={`${formatCurrency(overview.pendingValue)} waiting on a decision`}
          tone="amber"
        />
        <SummaryCard
          href="/reports"
          icon={TrophyIcon}
          label="Won this month"
          value={overview.wonThisMonth}
          hint={`${formatCurrency(overview.wonValue)} closed`}
          tone="emerald"
        />
      </div>

      <Panel delay={120}>
        <PanelHeader
          icon={PulseIcon}
          title="Recent activity"
          caption="Submissions, decisions and portal messages, newest first"
        />

        <ul className="mt-3 flex flex-col">
          {overview.activity.map((event) => {
            const Icon = ICONS[event.kind];

            return (
              <li
                key={event.id}
                className="flex items-center gap-3 border-t border-border/60 py-2.5 first:border-t-0"
              >
                <span
                  className={`flex size-7 shrink-0 items-center justify-center rounded-full bg-muted ${ACCENTS[event.kind]}`}
                >
                  <Icon size={13} weight="fill" />
                </span>

                <p className="min-w-0 flex-1 text-xs">
                  <span className="font-medium">{event.actor}</span>{" "}
                  <span className="text-muted-foreground">{event.summary}</span>{" "}
                  <Link
                    href={`/quotations/${event.quotationId}`}
                    className="font-medium hover:text-indigo-600 dark:hover:text-indigo-400"
                  >
                    {event.reference}
                  </Link>
                </p>

                <time
                  dateTime={event.at}
                  className="shrink-0 text-[11px] text-muted-foreground"
                >
                  {relativeTime(event.at)}
                </time>
              </li>
            );
          })}

          {overview.activity.length === 0 ? (
            <li className="py-10 text-center text-xs text-muted-foreground">
              Nothing has happened yet.
            </li>
          ) : null}
        </ul>
      </Panel>
    </main>
  );
}

const ICONS: Record<
  ActivityKind,
  React.ComponentType<{ size?: number; weight?: "fill" }>
> = {
  submitted: PaperPlaneTiltIcon,
  decision: CheckCircleIcon,
  message: ChatCircleIcon,
  closed: TrophyIcon,
};

const ACCENTS: Record<ActivityKind, string> = {
  submitted: "text-indigo-600 dark:text-indigo-400",
  decision: "text-amber-600 dark:text-amber-400",
  message: "text-sky-600 dark:text-sky-400",
  closed: "text-emerald-600 dark:text-emerald-400",
};

const CARD_TONES = {
  indigo: "text-indigo-600 dark:text-indigo-400",
  amber: "text-amber-600 dark:text-amber-400",
  emerald: "text-emerald-600 dark:text-emerald-400",
} as const;

function SummaryCard({
  href,
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  href: "/quotations" | "/approvals" | "/reports";
  icon: React.ComponentType<{ size?: number; weight?: "fill" }>;
  label: string;
  value: number;
  hint: string;
  tone: keyof typeof CARD_TONES;
}) {
  return (
    <Link href={href} className="block">
      <Panel className="p-3 transition-colors hover:bg-muted/40">
        <span className="flex items-center gap-2">
          <span className={`flex ${CARD_TONES[tone]}`}>
            <Icon size={15} weight="fill" />
          </span>
          <span className="text-[11px] text-muted-foreground">{label}</span>
        </span>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      </Panel>
    </Link>
  );
}

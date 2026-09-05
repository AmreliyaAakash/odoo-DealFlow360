import { formatDistanceToNow } from "date-fns";
import {
  ArrowUUpLeftIcon,
  CheckCircleIcon,
  ClockIcon,
  XCircleIcon,
} from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";
import { Panel, PanelHeader } from "@/components/dashboard/panel";
import { SealCheckIcon } from "@phosphor-icons/react/dist/ssr";

export type Decision = {
  id: string;
  level: string;
  action: string;
  reason: string | null;
  decidedBy: string;
  decidedAt: string;
};

const ACTION_STYLES = {
  approve: {
    icon: CheckCircleIcon,
    tone: "text-emerald-600 dark:text-emerald-400",
    verb: "approved",
  },
  reject: {
    icon: XCircleIcon,
    tone: "text-red-600 dark:text-red-400",
    verb: "rejected",
  },
  return: {
    icon: ArrowUUpLeftIcon,
    tone: "text-amber-600 dark:text-amber-400",
    verb: "returned",
  },
} as const;

/**
 * What the desk has done with this quotation, and what it is still waiting on.
 *
 * The rep who raised the deal can read this: without it, "pending approval" is
 * the only thing they ever learn, and a quotation sitting for a week looks the
 * same as one sitting for an hour.
 */
export function DecisionTimeline({
  decisions,
  outstanding,
}: {
  decisions: Decision[];
  /** Levels that still owe a decision. Empty once the deal has cleared. */
  outstanding: string[];
}) {
  if (decisions.length === 0 && outstanding.length === 0) return null;

  return (
    <Panel delay={240}>
      <PanelHeader
        icon={SealCheckIcon}
        title="Approval history"
        caption={
          outstanding.length === 0
            ? `${decisions.length} decision${decisions.length === 1 ? "" : "s"} recorded`
            : `Waiting on ${outstanding.join(" and ")}`
        }
      />

      <ol className="mt-3 flex flex-col gap-2">
        {decisions.map((decision) => {
          const style =
            ACTION_STYLES[decision.action as keyof typeof ACTION_STYLES] ??
            ACTION_STYLES.approve;
          const Icon = style.icon;

          return (
            <li
              key={decision.id}
              className="flex items-start gap-2 rounded-lg bg-muted/30 p-2.5 text-xs"
            >
              <Icon size={15} weight="fill" className={cn("mt-px shrink-0", style.tone)} />
              <div className="min-w-0 flex-1">
                <p>
                  <span className="font-medium capitalize">{decision.level}</span>{" "}
                  <span className={style.tone}>{style.verb}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {decision.decidedBy}
                  </span>
                </p>
                {decision.reason ? (
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    “{decision.reason}”
                  </p>
                ) : null}
              </div>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {formatDistanceToNow(new Date(decision.decidedAt), {
                  addSuffix: true,
                })}
              </span>
            </li>
          );
        })}

        {outstanding.map((level) => (
          <li
            key={level}
            className="flex items-center gap-2 rounded-lg border border-dashed border-border p-2.5 text-xs"
          >
            <ClockIcon size={15} className="shrink-0 text-muted-foreground" />
            <p className="text-muted-foreground">
              Waiting on <span className="font-medium capitalize">{level}</span>
            </p>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

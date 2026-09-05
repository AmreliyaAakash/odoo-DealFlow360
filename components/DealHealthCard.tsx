import Link from "next/link";
import { ArrowUpRightIcon } from "@phosphor-icons/react/dist/ssr";
import {
  isDiscountAnomaly,
  isStalled,
  type DealHealthQuotation,
} from "@/lib/business-logic";
import { formatCurrency } from "@/lib/quotations";
import { statusColor, statusLabel } from "@/lib/status";

/** B9 — one quotation on the deal-health board, badged by its health signals. */
export function DealHealthCard({ quotation }: { quotation: DealHealthQuotation }) {
  const stalled = isStalled(quotation);
  const anomalous = isDiscountAnomaly(quotation);
  const status = quotation.status ?? "draft";

  return (
    <article className="df-rise-in rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex items-center gap-2">
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ background: statusColor(status) }}
        />
        <h3 className="min-w-0 truncate text-sm font-semibold">
          <Link
            href={`/quotations/${quotation.id}`}
            className="hover:text-indigo-600 dark:hover:text-indigo-400"
          >
            {quotation.reference ?? quotation.id}
          </Link>
        </h3>
        <Link
          href={`/quotations/${quotation.id}`}
          aria-label={`Open ${quotation.reference ?? quotation.id}`}
          className="ml-auto shrink-0 text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowUpRightIcon size={13} />
        </Link>
      </div>

      <p className="mt-2 text-xl font-semibold tabular-nums">
        {formatCurrency(Number(quotation.net_total ?? 0))}
      </p>
      <p className="text-[11px] capitalize text-muted-foreground">
        {statusLabel(status)}
      </p>

      <div className="mt-3 flex flex-wrap gap-1">
        {stalled ? <Flag tone="amber">Stalled</Flag> : null}
        {anomalous ? <Flag tone="red">Discount anomaly</Flag> : null}
        {!stalled && !anomalous ? <Flag tone="emerald">Healthy</Flag> : null}
      </div>
    </article>
  );
}

const TONES = {
  amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  red: "bg-red-500/10 text-red-600 dark:text-red-400",
  emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
} as const;

function Flag({
  tone,
  children,
}: {
  tone: keyof typeof TONES;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

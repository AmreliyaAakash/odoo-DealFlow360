"use client";

import { PulseIcon } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "framer-motion";
import { Panel, PanelHeader } from "@/components/dashboard/panel";
import { ANOMALY_DELTA_PCT, type AnomalyRep } from "./types";

/**
 * Reps discounting above their own historical average. The baseline is personal,
 * so a rep who always sells deep is not flagged for consistency — only for drift.
 */
export function AnomalyHighlights({ reps }: { reps: AnomalyRep[] }) {
  return (
    <Panel delay={260} className="self-start">
      <PanelHeader
        icon={PulseIcon}
        title="Anomaly Highlights"
        caption={`Discount drift above ${ANOMALY_DELTA_PCT} pts`}
        href="/deal-health"
      />

      <div className="mt-3 flex flex-col gap-1">
        {reps.map((rep, index) => (
          <AnomalyRow key={rep.repId} rep={rep} index={index} />
        ))}

        {reps.length === 0 ? (
          <p className="py-8 text-center text-[11px] text-muted-foreground">
            No rep is discounting above their own baseline.
          </p>
        ) : null}
      </div>
    </Panel>
  );
}

function AnomalyRow({ rep, index }: { rep: AnomalyRep; index: number }) {
  const reduceMotion = useReducedMotion();

  // Deeper drift pulses faster; a mild one just sits there.
  const severe = rep.deltaPct >= ANOMALY_DELTA_PCT * 2;

  return (
    <motion.div
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.35, delay: 0.3 + index * 0.08 }}
      className="flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-muted/50"
    >
      <motion.span
        aria-hidden
        initial={{ opacity: 0, scale: 0.4 }}
        animate={
          severe && !reduceMotion
            ? { opacity: [0.45, 1, 0.45], scale: 1 }
            : { opacity: 1, scale: 1 }
        }
        transition={
          severe && !reduceMotion
            ? { opacity: { duration: 1.6, repeat: Infinity }, scale: { duration: 0.3 } }
            : { duration: 0.4, delay: 0.35 + index * 0.08 }
        }
        className="size-2 shrink-0 rounded-full bg-red-500"
      />

      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">{rep.repName}</p>
        <p className="text-[11px] text-muted-foreground tabular-nums">
          now {rep.currentAvgPct}% vs usual {rep.historicalAvgPct}% ·{" "}
          {rep.openDeals} open
        </p>
      </div>

      <span className="shrink-0 rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-medium tabular-nums text-red-600 dark:text-red-400">
        +{rep.deltaPct} pts
      </span>
    </motion.div>
  );
}

"use client";

import { CheckIcon, ProhibitIcon } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "framer-motion";
import {
  PORTAL_STAGES,
  PORTAL_STAGE_LABELS,
  type PortalStage,
} from "@/lib/business-logic";
import { cn } from "@/lib/utils";

/**
 * The customer's view of where their quote has got to. Steps before the current
 * one read as done, the current one pulses, later ones stay muted.
 */
export function QuoteStepper({
  stage,
  closedLost,
}: {
  stage: PortalStage;
  closedLost: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const currentIndex = PORTAL_STAGES.indexOf(stage);

  return (
    <ol className="flex flex-col gap-1 sm:flex-row sm:items-start">
      {PORTAL_STAGES.map((step, index) => {
        const done = index < currentIndex;
        const current = index === currentIndex && !closedLost;
        const last = index === PORTAL_STAGES.length - 1;

        return (
          <li
            key={step}
            className="flex flex-1 gap-3 sm:flex-col sm:items-center sm:gap-2 sm:text-center"
          >
            <div className="flex flex-col items-center sm:w-full sm:flex-row">
              {/* Spacer keeps the first marker centred over its label. */}
              <span className="hidden flex-1 sm:block">
                {index > 0 ? <Connector filled={done || current} /> : null}
              </span>

              <Marker
                index={index}
                done={done}
                current={current}
                closedLost={closedLost && index === currentIndex}
                reduceMotion={Boolean(reduceMotion)}
              />

              <span className="hidden flex-1 sm:block">
                {!last ? <Connector filled={done} /> : null}
              </span>

              {/* Vertical rail on narrow screens. */}
              {!last ? (
                <span
                  className={cn(
                    "my-1 w-px flex-1 sm:hidden",
                    done ? "bg-sky-500" : "bg-border",
                  )}
                />
              ) : null}
            </div>

            <div className="pb-4 sm:pb-0">
              <p
                className={cn(
                  "text-xs font-medium transition-colors",
                  current
                    ? "text-sky-600 dark:text-sky-400"
                    : done
                      ? "text-foreground"
                      : "text-muted-foreground",
                )}
              >
                {PORTAL_STAGE_LABELS[step]}
              </p>
              {current ? (
                <p className="text-[11px] text-muted-foreground">In progress</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Connector({ filled }: { filled: boolean }) {
  return (
    <span className="block h-px w-full bg-border">
      <motion.span
        className="block h-px bg-sky-500"
        initial={{ scaleX: 0 }}
        animate={{ scaleX: filled ? 1 : 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        style={{ transformOrigin: "left" }}
      />
    </span>
  );
}

function Marker({
  index,
  done,
  current,
  closedLost,
  reduceMotion,
}: {
  index: number;
  done: boolean;
  current: boolean;
  closedLost: boolean;
  reduceMotion: boolean;
}) {
  const pulsing = current && !reduceMotion;

  return (
    <span className="relative flex size-7 shrink-0 items-center justify-center">
      {/* Soft halo, only under the step the quote is actually on. */}
      {pulsing ? (
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full bg-sky-500/25"
          animate={{ scale: [1, 1.55, 1], opacity: [0.5, 0, 0.5] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
        />
      ) : null}

      <motion.span
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{
          duration: 0.4,
          delay: index * 0.08,
          ease: [0.22, 1, 0.36, 1],
        }}
        className={cn(
          "relative flex size-7 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums ring-1",
          closedLost
            ? "bg-red-500 text-white ring-red-500"
            : done
              ? "bg-sky-500 text-white ring-sky-500"
              : current
                ? "bg-sky-500 text-white ring-sky-500"
                : "bg-muted text-muted-foreground ring-border",
        )}
      >
        {closedLost ? (
          <ProhibitIcon size={13} weight="bold" />
        ) : done ? (
          <CheckIcon size={13} weight="bold" />
        ) : (
          index + 1
        )}
      </motion.span>
    </span>
  );
}

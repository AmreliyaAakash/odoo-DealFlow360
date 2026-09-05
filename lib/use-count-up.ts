"use client";

import { useEffect, useState } from "react";

/**
 * Animates from 0 to `target` on mount. Respects `prefers-reduced-motion` by
 * jumping straight to the final value.
 *
 * Every state update happens inside the animation-frame callback rather than in
 * the effect body, so mounting does not trigger a cascading render.
 */
export function useCountUp(target: number, durationMs = 900): number {
  const [value, setValue] = useState(0);

  useEffect(() => {
    let frame = 0;
    let start: number | null = null;

    const tick = (now: number) => {
      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;

      if (reduceMotion || target === 0) {
        setValue(target);
        return;
      }

      start ??= now;

      const progress = Math.min((now - start) / durationMs, 1);
      // easeOutCubic — fast first, settling into the final number.
      const eased = 1 - Math.pow(1 - progress, 3);

      setValue(target * eased);

      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      }
    };

    frame = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(frame);
  }, [target, durationMs]);

  return value;
}

"use client";

import { useSyncExternalStore } from "react";

/** Nothing to subscribe to: the value flips once, at hydration. */
const subscribe = () => () => {};

/**
 * False on the server and during the first client render, true afterwards.
 *
 * Use it to gate anything whose server output cannot match the browser's —
 * locale-formatted dates, timezones, relative times. Rendering a placeholder for
 * one frame is what keeps React from reporting a hydration mismatch.
 */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

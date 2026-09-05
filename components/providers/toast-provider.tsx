"use client";

import { useMemo } from "react";
import { Toaster, toast as manager } from "@/components/ui/toast";

/**
 * App-wide notifications.
 *
 * Ten screens had grown their own `const [error, setError] = useState(null)` and
 * a paragraph of red text below the form. That works, but it means an error can
 * scroll out of view, a success is invisible, and every screen words the same
 * failure differently. One manager, mounted once, gives them a shared surface.
 *
 * The Base UI toast manager is a module singleton, so `useToast()` does not need
 * a context of its own — but the viewport must be mounted exactly once, which is
 * what `<Toaster>` here is for.
 */

export function ToastProvider({ children }: { children: React.ReactNode }) {
  return <Toaster>{children}</Toaster>;
}

export type ToastInput = {
  title: string;
  description?: string;
};

export type UseToast = {
  success: (input: ToastInput | string) => void;
  error: (input: ToastInput | string | unknown) => void;
  info: (input: ToastInput | string) => void;
};

function normalise(input: ToastInput | string): ToastInput {
  return typeof input === "string" ? { title: input } : input;
}

/**
 * Turns whatever was thrown into something worth showing.
 *
 * Callers routinely pass a caught `unknown`, and an "[object Object]" toast is
 * worse than no toast — so anything unrecognisable becomes a plain sentence
 * rather than being stringified.
 */
function fromError(input: ToastInput | string | unknown): ToastInput {
  if (typeof input === "string") return { title: input };
  if (input instanceof Error) return { title: input.message };

  if (
    typeof input === "object" &&
    input !== null &&
    "title" in input &&
    typeof (input as ToastInput).title === "string"
  ) {
    return input as ToastInput;
  }

  return { title: "Something went wrong. Please try again." };
}

export function useToast(): UseToast {
  return useMemo(
    () => ({
      success: (input) => {
        const { title, description } = normalise(input);
        manager.add({ title, description, type: "success" });
      },
      info: (input) => {
        const { title, description } = normalise(input);
        manager.add({ title, description, type: "info" });
      },
      error: (input) => {
        const { title, description } = fromError(input);
        // Failures stay until dismissed: a toast that vanishes before it is read
        // is the same as not reporting the failure at all.
        manager.add({ title, description, type: "error", timeout: 0 });
      },
    }),
    [],
  );
}

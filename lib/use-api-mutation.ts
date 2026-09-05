"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/providers/toast-provider";

/**
 * Calling one of this app's API routes from a component.
 *
 * Ten screens had written the same twelve lines: set pending, fetch, parse JSON,
 * read `body.error` on a non-2xx, set an error string, unset pending in a
 * `finally`. Each was subtly different — some swallowed the error, some ignored
 * the status, some left the button spinning if JSON parsing threw.
 *
 * Every route in this app answers the same way: JSON, with `{ error }` on
 * failure. That contract is what makes one hook possible.
 */

export type MutationOptions<T> = {
  /** Shown as a toast on success. Omit for actions that speak for themselves. */
  successMessage?: string;
  /** Prefixes the server's message, e.g. "Could not change the role". */
  errorMessage?: string;
  /** Re-render the server components on this route once it succeeds. */
  refresh?: boolean;
  onSuccess?: (data: T) => void;
};

export type Mutation<T> = {
  /** Resolves with the parsed body, or null when the call failed. */
  run: (init?: RequestInit) => Promise<T | null>;
  pending: boolean;
  /** The last failure, for screens that show it inline as well as in a toast. */
  error: string | null;
  reset: () => void;
};

/**
 * `url` may be a string or a function, so a row component can build the URL from
 * its own id at call time without re-creating the hook.
 */
export function useApiMutation<T = unknown>(
  url: string | (() => string),
  options: MutationOptions<T> = {},
): Mutation<T> {
  const { successMessage, errorMessage, refresh = false, onSuccess } = options;

  const router = useRouter();
  const toast = useToast();

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (init: RequestInit = {}): Promise<T | null> => {
      setPending(true);
      setError(null);

      try {
        const response = await fetch(typeof url === "function" ? url() : url, {
          ...init,
          headers:
            init.body === undefined
              ? init.headers
              : { "Content-Type": "application/json", ...init.headers },
        });

        // A 500 from a proxy or a crashed route can arrive as HTML, so a failed
        // parse must not masquerade as a network error.
        let body: unknown = null;
        try {
          body = await response.json();
        } catch {
          body = null;
        }

        if (!response.ok) {
          const serverMessage =
            typeof body === "object" && body !== null && "error" in body
              ? String((body as { error: unknown }).error)
              : `Request failed (${response.status})`;

          throw new Error(
            errorMessage ? `${errorMessage}: ${serverMessage}` : serverMessage,
          );
        }

        if (successMessage) toast.success(successMessage);
        onSuccess?.(body as T);
        if (refresh) router.refresh();

        return body as T;
      } catch (cause) {
        const message =
          cause instanceof Error ? cause.message : (errorMessage ?? "Request failed");
        setError(message);
        toast.error(message);
        return null;
      } finally {
        setPending(false);
      }
    },
    [url, errorMessage, successMessage, refresh, onSuccess, router, toast],
  );

  const reset = useCallback(() => setError(null), []);

  return { run, pending, error, reset };
}

/** `run` shorthands for the verbs this app actually uses. */
export function jsonBody(data: unknown): RequestInit {
  return { method: "POST", body: JSON.stringify(data) };
}

export function patchBody(data: unknown): RequestInit {
  return { method: "PATCH", body: JSON.stringify(data) };
}

export function putBody(data: unknown): RequestInit {
  return { method: "PUT", body: JSON.stringify(data) };
}

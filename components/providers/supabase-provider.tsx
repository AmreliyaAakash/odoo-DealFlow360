"use client";

import { createContext, useContext, useMemo } from "react";
import { useAuth } from "@clerk/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClerkSupabaseClient } from "@/lib/supabase";

/**
 * One Supabase client for the whole app.
 *
 * Previously every component called `useSupabase()` and got its own client, so
 * the deal-health table and the audit feed each opened a separate realtime
 * connection to the same project — two websockets, two subscription sets, and
 * two of everything else as more live screens are added. Sharing one client
 * through context makes those channels multiplex over a single connection.
 *
 * The client is rebuilt only when the Clerk session changes, because `getToken`
 * is stable for the lifetime of a session and the client asks it for a fresh
 * token on every request anyway.
 */

const SupabaseContext = createContext<SupabaseClient | null>(null);

export function SupabaseProvider({ children }: { children: React.ReactNode }) {
  const { getToken } = useAuth();

  const client = useMemo(
    () =>
      createClerkSupabaseClient(async () => {
        // supabase-js probes `accessToken` while constructing the client, which
        // happens during SSR too — and Clerk's `getToken` throws off-browser.
        if (typeof window === "undefined") return null;
        return getToken();
      }),
    [getToken],
  );

  return (
    <SupabaseContext.Provider value={client}>{children}</SupabaseContext.Provider>
  );
}

/**
 * The shared client, bound to the signed-in Clerk session.
 *
 * Throws outside the provider rather than quietly building a second client:
 * a component that slipped out of the tree would otherwise keep working while
 * holding its own connection, which is the exact problem this replaced.
 */
export function useSupabase(): SupabaseClient {
  const client = useContext(SupabaseContext);

  if (client === null) {
    throw new Error(
      "useSupabase must be used inside <SupabaseProvider> (mounted in app/providers.tsx)",
    );
  }

  return client;
}

"use client";

import { useAuth } from "@clerk/nextjs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { useMemo } from "react";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  );
}

/**
 * Builds a browser Supabase client that asks `getToken` for a fresh Clerk JWT on
 * every request. Supabase sends it as the `Authorization` bearer, so RLS policies
 * can match rows with `auth.jwt() ->> 'sub'` (the Clerk user ID).
 *
 * Uses Clerk's native Supabase integration: the plain session token, no JWT
 * template. Supabase must have Clerk registered under Authentication →
 * Third-Party Auth, and Clerk's session token must carry `"role": "authenticated"`.
 */
export function createClerkSupabaseClient(
  getToken: () => Promise<string | null>,
): SupabaseClient {
  return createClient(supabaseUrl!, supabasePublishableKey!, {
    accessToken: getToken,
  });
}

/**
 * Returns a Supabase client bound to the signed-in Clerk session. Clerk's
 * `getToken` is stable for the lifetime of a session, so the client is only
 * rebuilt when the user signs in or out.
 *
 * While signed out, `accessToken` resolves to `null` and requests fall back to
 * the anon role — RLS still applies.
 */
export function useSupabase(): SupabaseClient {
  const { getToken } = useAuth();

  return useMemo(
    () =>
      createClerkSupabaseClient(async () => {
        // supabase-js probes `accessToken` while constructing the client, which
        // happens during SSR too — and Clerk's `getToken` throws off-browser.
        if (typeof window === "undefined") return null;
        return getToken();
      }),
    [getToken],
  );
}

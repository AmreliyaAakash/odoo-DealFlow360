"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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
 *
 * Components do not call this. `SupabaseProvider` calls it once and shares the
 * result through context — see `useSupabase()` in
 * `components/providers/supabase-provider.tsx`. Calling it per component is what
 * used to open a separate realtime connection for every live screen.
 */
export function createClerkSupabaseClient(
  getToken: () => Promise<string | null>,
): SupabaseClient {
  return createClient(supabaseUrl!, supabasePublishableKey!, {
    accessToken: getToken,
  });
}

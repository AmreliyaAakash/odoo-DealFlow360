import { auth } from "@clerk/nextjs/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  );
}

/**
 * Server-side twin of `useSupabase()`. Mints the Clerk session token per request
 * so RLS policies see the same `auth.jwt() ->> 'sub'` (the Clerk user ID) they do
 * in the browser. Use in Server Components, Route Handlers and Server Actions.
 *
 * Uses Clerk's native Supabase integration — the plain session token, no JWT
 * template. See `lib/supabase.ts` for the setup both sides require.
 */
export function createServerSupabaseClient(): SupabaseClient {
  return createClient(supabaseUrl!, supabaseKey!);
}

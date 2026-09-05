"use client";

import { SupabaseProvider } from "@/components/providers/supabase-provider";
import { ToastProvider } from "@/components/providers/toast-provider";

/**
 * Everything the browser half of the app shares, mounted once.
 *
 * Order matters: `SupabaseProvider` calls Clerk's `useAuth`, so it has to sit
 * inside `<ClerkProvider>` — which is why this is composed in the root layout
 * rather than wrapping it.
 *
 * The permissions context is not here on purpose. It carries a value the server
 * resolves per request, so it belongs to the dashboard layout that resolves it,
 * not to a provider that would have nothing to put in it on the portal or the
 * sign-in screen.
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <SupabaseProvider>
      <ToastProvider>{children}</ToastProvider>
    </SupabaseProvider>
  );
}

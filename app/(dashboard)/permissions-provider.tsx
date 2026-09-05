"use client";

import { createContext, useContext } from "react";
import type { Access, Module } from "@/lib/permissions";
import type { Role } from "@/types/globals";

/**
 * Carries the server's resolved access down to client components.
 *
 * Without it, `useRole()` falls back to the static matrix for the Clerk role,
 * which is right for a plain account and wrong for one with an override — the
 * sidebar would hide a module the account had actually been granted. The server
 * resolves it once per request in the layout and hands the answer over.
 */

export type ResolvedPermissions = {
  role: Role | null;
  access: Record<Module, Access>;
  customized: boolean;
};

const PermissionsContext = createContext<ResolvedPermissions | null>(null);

export function PermissionsProvider({
  value,
  children,
}: {
  value: ResolvedPermissions;
  children: React.ReactNode;
}) {
  return (
    <PermissionsContext.Provider value={value}>
      {children}
    </PermissionsContext.Provider>
  );
}

/** Null outside the provider, which is the signal to fall back to the matrix. */
export function useResolvedPermissions(): ResolvedPermissions | null {
  return useContext(PermissionsContext);
}

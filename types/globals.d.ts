export type Role = "admin" | "manager" | "finance" | "rep";

declare global {
  interface CustomJwtSessionClaims {
    publicMetadata?: {
      role?: Role;
    };
  }
}

export {};

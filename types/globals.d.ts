/**
 * `customer` is a portal user, not a staff member: they sign in through
 * /portal and see only their own quotation. Every other role is internal.
 */
export type Role = "admin" | "manager" | "finance" | "rep" | "customer";

declare global {
  interface CustomJwtSessionClaims {
    publicMetadata?: {
      role?: Role;
    };
  }
}

export {};

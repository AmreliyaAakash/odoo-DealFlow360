/**
 * `customer` is a portal user, not a staff member: they sign in through
 * /portal and see only their own quotation. Every other role is internal.
 *
 * `specialist` is the one role with no department of its own. It starts with
 * nothing and is granted module by module from Users & Roles, for the people
 * whose work does not sit inside sales, approvals or finance.
 */
export type Role =
  | "admin"
  | "manager"
  | "finance"
  | "rep"
  | "specialist"
  | "customer";

declare global {
  interface CustomJwtSessionClaims {
    publicMetadata?: {
      role?: Role;
    };
  }
}

export {};

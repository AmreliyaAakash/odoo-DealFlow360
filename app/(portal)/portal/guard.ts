import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase-server";

/**
 * Portal access, checked against the database rather than the URL.
 *
 * The route guard keeps staff out of /portal, but "which quotation is yours" is
 * not something a matcher can answer — it is a row-level fact. This resolves the
 * signed-in Clerk user to their `customers` row and refuses anything not linked
 * to it, so swapping the quoteId in the address bar gets you nowhere even with a
 * valid customer session.
 */

export type PortalIdentity = {
  userId: string;
  customerId: string;
};

export type PortalAccess =
  | { ok: true; identity: PortalIdentity }
  | { ok: false; reason: "signedOut" | "notCustomer" | "unlinked" };

/**
 * The signed-in portal customer, or why they are not one. Callers redirect on
 * `signedOut`; the other two render an explanation, because a customer landing
 * on an unlinked account needs to be told to contact their account manager, not
 * bounced around a sign-in loop.
 */
export async function portalIdentity(): Promise<PortalAccess> {
  const { userId, role } = await currentUser();

  if (!userId) return { ok: false, reason: "signedOut" };

  // The portal belongs to the `customer` role alone. Staff have their own
  // screens onto the same deal and are not let in through this door.
  if (role !== "customer") return { ok: false, reason: "notCustomer" };

  const supabase = createServerSupabaseClient();

  const { data, error } = await supabase
    .from("customers")
    .select("id")
    .eq("portal_user_id", userId)
    .maybeSingle<{ id: string }>();

  if (error || !data) return { ok: false, reason: "unlinked" };

  return { ok: true, identity: { userId, customerId: data.id } };
}

/**
 * True when `customerId` is the customer this user is linked to.
 *
 * RLS enforces the same rule, so this is belt and braces — but it turns a
 * confusing empty result into a deliberate refusal, and it keeps the check
 * visible in the code path rather than only in the database.
 */
export function ownsCustomer(identity: PortalIdentity, customerId: string | null) {
  return customerId !== null && customerId === identity.customerId;
}

/** Sends a signed-out visitor to the portal's own sign-in. */
export async function requirePortalIdentity(): Promise<PortalAccess> {
  const access = await portalIdentity();
  if (!access.ok && access.reason === "signedOut") redirect("/portal");
  return access;
}

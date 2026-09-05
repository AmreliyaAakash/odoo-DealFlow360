import { redirect } from "next/navigation";
import { currentRole, landingPathForRole } from "@/lib/auth";

/**
 * Auto-redirects any unauthorized visits straight back to the user's appropriate role workspace.
 */
export default async function UnauthorizedPage() {
  const role = await currentRole();
  redirect(landingPathForRole(role));
}

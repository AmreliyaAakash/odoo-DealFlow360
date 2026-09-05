import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { currentRole, landingPathForRole } from "@/lib/auth";

/**
 * Entry point. Signed-out visitors go to sign-in; signed-in ones are routed to
 * the workspace their role actually uses.
 */
export default async function Home() {
  const { userId } = await auth();

  if (!userId) {
    redirect("/sign-in");
  }

  redirect(landingPathForRole(await currentRole()));
}

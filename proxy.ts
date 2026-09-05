import { clerkMiddleware, clerkClient, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { Role } from "@/types/globals";

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/portal",
]);
const isBackendRoute = createRouteMatcher(["/backend(.*)"]);
const isApprovalsRoute = createRouteMatcher([
  "/approvals(.*)",
  "/manager(.*)",
  "/finance(.*)",
]);
const isApiRoute = createRouteMatcher(["/api(.*)", "/trpc(.*)"]);

const ROLES = new Set<string>(["admin", "manager", "finance", "rep"]);

function asRole(value: unknown): Role | null {
  return typeof value === "string" && ROLES.has(value) ? (value as Role) : null;
}

export default clerkMiddleware(async (auth, request) => {
  if (isPublicRoute(request)) {
    return;
  }

  const { userId, sessionClaims, redirectToSignIn } = await auth();

  // API clients get a status code they can act on; only pages get sent to a
  // sign-in screen.
  if (!userId) {
    return isApiRoute(request)
      ? NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      : redirectToSignIn({ returnBackUrl: request.url });
  }

  const gated = isBackendRoute(request) || isApprovalsRoute(request);
  if (!gated) return;

  let role = asRole(sessionClaims?.publicMetadata?.role);

  // The claim is missing until Clerk's session token is customised. Rather than
  // deny a legitimate admin, look the role up — but only on the gated routes, so
  // ordinary pages never pay for the round trip.
  if (role === null) {
    try {
      const user = await (await clerkClient()).users.getUser(userId);
      role = asRole(user.publicMetadata?.role);
    } catch {
      role = null;
    }
  }

  const isForbidden =
    (isBackendRoute(request) && role !== "admin") ||
    (isApprovalsRoute(request) &&
      role !== "manager" &&
      role !== "finance" &&
      role !== "admin");

  if (isForbidden) {
    return isApiRoute(request)
      ? NextResponse.json({ error: "Forbidden" }, { status: 403 })
      : NextResponse.redirect(new URL("/", request.url));
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files, unless found in search params
    "/((?!_next|[^?]*\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};

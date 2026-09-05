import { clerkMiddleware, clerkClient, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { asRole } from "@/lib/roles";
import type { Role } from "@/types/globals";

/**
 * Route-level access control.
 *
 * Next 16 renamed `middleware.ts` to `proxy.ts`; the file convention is the same
 * one the task calls middleware, and `middleware.ts` would no longer run.
 *
 * This is the outer gate and the coarsest of the three layers. It decides who
 * may load a URL — not what they may see on it, and not what they may write.
 * Row scoping happens in queries, and every write is refused again by the API
 * guards in `lib/auth.ts` and by RLS in the database.
 */

/**
 * Reachable without a session. The portal is included so a customer following a
 * quote link while signed out lands on the portal's own email-link sign-in
 * rather than the staff one; each portal page redirects to /portal itself.
 */
const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/portal(.*)",
  "/unauthorized",
]);

/**
 * The setup check needs a session but no role — it exists precisely for the case
 * where the role is what is broken, so gating it on one would make it useless.
 */
const isDiagnosticsRoute = createRouteMatcher(["/diagnostics", "/api/diagnostics"]);

const isApiRoute = createRouteMatcher(["/api(.*)", "/trpc(.*)"]);

/**
 * Who may load what. First match wins, so more specific patterns come first.
 * A path with no entry here needs a session but no particular role.
 */
const ROUTE_ROLES: { matcher: ReturnType<typeof createRouteMatcher>; roles: Role[] }[] = [
  // Admin console and every backend config screen.
  { matcher: createRouteMatcher(["/admin(.*)", "/backend(.*)"]), roles: ["admin"] },

  { matcher: createRouteMatcher(["/manager(.*)"]), roles: ["manager", "admin"] },
  { matcher: createRouteMatcher(["/finance(.*)"]), roles: ["finance", "admin"] },

  // Reps own the desk; approvers look in on it.
  {
    matcher: createRouteMatcher(["/rep(.*)"]),
    roles: ["rep", "manager", "finance", "admin"],
  },

  // A rep reaches reports, but only ever sees their own rows — that narrowing is
  // done in the query, not here.
  {
    matcher: createRouteMatcher(["/reports(.*)"]),
    roles: ["rep", "manager", "finance", "admin"],
  },

  {
    matcher: createRouteMatcher(["/approvals(.*)"]),
    roles: ["rep", "manager", "finance", "admin"],
  },
  {
    matcher: createRouteMatcher(["/quotations(.*)"]),
    roles: ["rep", "manager", "finance", "admin"],
  },
  {
    matcher: createRouteMatcher(["/deal-health(.*)"]),
    roles: ["rep", "manager", "finance", "admin"],
  },

  // The portal belongs to the customer. Staff have their own screens onto the
  // same deal, so none of them are let in here.
  { matcher: createRouteMatcher(["/portal(.*)"]), roles: ["customer"] },
];

function requiredRoles(request: Request): Role[] | null {
  for (const entry of ROUTE_ROLES) {
    // createRouteMatcher accepts the proxy's request object directly.
    if (entry.matcher(request as Parameters<typeof entry.matcher>[0])) {
      return entry.roles;
    }
  }
  return null;
}

export default clerkMiddleware(async (auth, request) => {
  const { userId, sessionClaims, redirectToSignIn } = await auth();

  // Signed out: the portal and the auth screens are open, everything else sends
  // you to sign in. API clients get a status code instead of a redirect.
  if (!userId) {
    if (isPublicRoute(request)) return;

    return isApiRoute(request)
      ? NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      : redirectToSignIn({ returnBackUrl: request.url });
  }

  if (isDiagnosticsRoute(request)) return;

  const allowed = requiredRoles(request);
  if (!allowed) return;

  let role = asRole(sessionClaims?.publicMetadata?.role);

  // The claim is missing until Clerk's session token is customised. Rather than
  // deny a legitimate admin, look the role up — but only on the gated routes, so
  // ungated pages never pay for the round trip.
  if (role === null) {
    try {
      const user = await (await clerkClient()).users.getUser(userId);
      role = asRole(user.publicMetadata?.role);
    } catch {
      role = null;
    }
  }

  if (role !== null && allowed.includes(role)) return;

  return isApiRoute(request)
    ? NextResponse.json({ error: "Forbidden" }, { status: 403 })
    : NextResponse.redirect(new URL("/unauthorized", request.url));
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files, unless found in search params
    "/((?!_next|[^?]*\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};

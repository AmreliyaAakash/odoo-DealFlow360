import Link from "next/link";
import { currentRole, landingPathForRole } from "@/lib/auth";
import { roleLabel } from "@/lib/roles";

/**
 * Where a screen sends someone who may not open it.
 *
 * This used to redirect straight to the role's landing page, which is a loop
 * waiting to happen: the landing page has a guard of its own, and if that guard
 * is the one refusing you, it sends you back here and the browser gives up with
 * ERR_TOO_MANY_REDIRECTS. That is not hypothetical — a Specialist starts with
 * every module at `none`, so `/dashboard` (which needs `quotationBuilder`)
 * refuses them, and the two pages bounced the request between each other until
 * the browser stopped it. Every other role happens to hold `quotationBuilder`,
 * which is why it stayed hidden.
 *
 * So this renders instead of redirecting. A page that exists to say "no" cannot
 * itself depend on somewhere else saying "yes".
 */
export default async function UnauthorizedPage() {
  const role = await currentRole();
  const home = landingPathForRole(role);

  return (
    <main className="flex min-h-screen flex-1 items-center justify-center p-6">
      <div className="max-w-sm rounded-2xl bg-card p-6 text-center ring-1 ring-foreground/10">
        <h1 className="text-base font-semibold">You do not have access to that screen</h1>

        <p className="mt-2 text-xs text-muted-foreground">
          Your account is set up as{" "}
          <span className="font-medium text-foreground">{roleLabel(role)}</span>
          {role === "specialist"
            ? ", which starts with no modules until an admin grants them."
            : ", which does not include this area."}{" "}
          Ask an admin to grant you the module if you need it.
        </p>

        <Link
          href={home}
          className="mt-4 inline-flex rounded-lg bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-50 transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Back to {home === "/portal" ? "your portal" : "the dashboard"}
        </Link>
      </div>
    </main>
  );
}

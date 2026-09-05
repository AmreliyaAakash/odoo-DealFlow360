import Link from "next/link";
import { ProhibitIcon } from "@phosphor-icons/react/dist/ssr";
import { currentRole, landingPathForRole } from "@/lib/auth";

/**
 * Where the route guard sends a signed-in user who may not load a page.
 *
 * Deliberately vague about what is behind the door — it names the role you hold,
 * not the roles that would have got you in — and offers the way back to your own
 * workspace, which is the only useful action from here.
 */
export default async function UnauthorizedPage() {
  const role = await currentRole();

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="max-w-sm rounded-2xl bg-card p-6 text-center ring-1 ring-foreground/10">
        <span className="mx-auto flex size-10 items-center justify-center rounded-full bg-red-500/10 text-red-600 dark:text-red-400">
          <ProhibitIcon size={20} weight="bold" />
        </span>

        <h1 className="mt-4 text-base font-semibold">You cannot open this page</h1>

        <p className="mt-2 text-xs text-muted-foreground">
          {role
            ? `Your account is signed in as ${role}, which does not have access here.`
            : "Your account does not have a role assigned yet."}{" "}
          Ask an administrator if you think this is wrong.
        </p>

        <Link
          href={landingPathForRole(role)}
          className="mt-5 inline-flex rounded-lg bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-50 transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Back to your workspace
        </Link>
      </div>
    </main>
  );
}

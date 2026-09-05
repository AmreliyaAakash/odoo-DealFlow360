import Image from "next/image";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { CheckCircleIcon, WarningCircleIcon, XCircleIcon } from "@phosphor-icons/react/dist/ssr";
import { headers } from "next/headers";
import type { Diagnostics } from "@/app/api/diagnostics/route";

/**
 * Setup check.
 *
 * Deliberately outside the dashboard layout: when something is wrong, the
 * sidebar and its queries are exactly what fails, and a diagnostics page that
 * cannot render is worthless. Any signed-in user can open it — the whole point
 * is that whoever is stuck can see why without needing the access they are
 * missing.
 */
export default async function DiagnosticsPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const incoming = await headers();
  const host = incoming.get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") ? "http" : "https";

  const response = await fetch(`${protocol}://${host}/api/diagnostics`, {
    headers: { cookie: incoming.get("cookie") ?? "" },
    cache: "no-store",
  });

  if (!response.ok) {
    return (
      <Shell>
        <p className="text-sm text-red-600 dark:text-red-400">
          Diagnostics failed to run ({response.status}).
        </p>
      </Shell>
    );
  }

  const data = (await response.json()) as Diagnostics;

  return (
    <Shell>
      <div
        className={
          data.verdict.ok
            ? "rounded-xl bg-emerald-500/10 p-4 ring-1 ring-emerald-500/30"
            : "rounded-xl bg-amber-500/10 p-4 ring-1 ring-amber-500/30"
        }
      >
        <p className="flex items-center gap-2 text-sm font-semibold">
          {data.verdict.ok ? (
            <CheckCircleIcon size={18} weight="fill" className="text-emerald-600" />
          ) : (
            <WarningCircleIcon size={18} weight="fill" className="text-amber-600" />
          )}
          {data.verdict.headline}
        </p>
        {data.verdict.fix ? (
          <p className="mt-2 text-xs whitespace-pre-wrap text-muted-foreground">
            {data.verdict.fix}
          </p>
        ) : null}
      </div>

      <Section title="Clerk">
        <Row label="User ID" value={data.clerk.userId} mono />
        <Row
          label="Role on the user record"
          value={data.clerk.roleFromApi ?? "not set"}
          ok={data.clerk.roleFromApi !== null}
        />
        <Row
          label="Role on the session token"
          value={data.clerk.roleFromClaim ?? "missing"}
          ok={data.clerk.claimPresent}
          hint={
            data.clerk.claimPresent
              ? undefined
              : "RLS reads this one. Without it the database treats you as having no role."
          }
        />
        <Row label="Claims on the token" value={data.clerk.tokenClaims.join(", ") || "—"} mono />
      </Section>

      <Section title="Database">
        <Row
          label="clerk_role()"
          value={data.database.clerkRole ?? "null"}
          ok={data.database.clerkRole !== null}
          hint={
            data.database.clerkRole === null
              ? "Postgres cannot see your role, so every policy denies and every table looks empty."
              : undefined
          }
        />
        <Row
          label="is_staff()"
          value={String(data.database.isStaff)}
          ok={data.database.isStaff === true}
        />
        <Row
          label="Permission layer installed"
          value={data.database.permissionLayerInstalled ? "yes" : "no"}
          ok={data.database.permissionLayerInstalled}
          hint={
            data.database.permissionLayerInstalled
              ? undefined
              : "role_module_permissions is missing — db/setup.sql has not been run since it was added."
          }
        />
        {data.database.error ? (
          <Row label="Error" value={data.database.error} />
        ) : null}
      </Section>

      <Section title="Rows this session can read">
        <div className="grid gap-1 sm:grid-cols-2">
          {data.tables.map((table) => (
            <div
              key={table.table}
              className="flex items-center gap-2 rounded-lg bg-muted/40 px-2.5 py-1.5"
            >
              {table.status === "ok" ? (
                <CheckCircleIcon size={13} weight="fill" className="text-emerald-600" />
              ) : table.status === "missing" ? (
                <XCircleIcon size={13} weight="fill" className="text-red-600" />
              ) : (
                <WarningCircleIcon size={13} weight="fill" className="text-amber-600" />
              )}
              <span className="font-mono text-[11px]">{table.table}</span>
              <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                {table.status === "missing"
                  ? "missing"
                  : table.status === "error"
                    ? table.detail
                    : `${table.visible} rows`}
              </span>
            </div>
          ))}
        </div>
      </Section>

      <p className="text-[11px] text-muted-foreground">
        Counts are what <em>your</em> session can read, after row-level security.
        Zero everywhere with a role set almost always means the session token is
        missing <code>publicMetadata</code>, not that the data is gone.
      </p>

      <Link href="/" className="text-xs text-indigo-600 hover:underline dark:text-indigo-400">
        ← Back to the app
      </Link>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 p-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2.5">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-zinc-950 p-2 shadow-xs dark:bg-zinc-100">
            <Image
              src="/icon.png"
              alt="DealFlow360 Icon"
              width={28}
              height={28}
              className="size-5.5 object-contain invert dark:invert-0"
            />
          </div>
          <Image
            src="/logo.png"
            alt="DealFlow360"
            width={180}
            height={32}
            className="h-[28px] w-auto object-contain dark:invert"
          />
        </div>
        <div>
          <h1 className="text-base font-semibold tracking-tight">Setup check</h1>
          <p className="text-xs text-muted-foreground">
            Walks the chain from Clerk to Postgres and reports the first broken link.
          </p>
        </div>
      </header>
      {children}
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      <div className="flex flex-col gap-1.5">{children}</div>
    </section>
  );
}

function Row({
  label,
  value,
  ok,
  mono,
  hint,
}: {
  label: string;
  value: string;
  ok?: boolean;
  mono?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <div className="flex items-baseline gap-3 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span
          className={[
            "ml-auto break-all text-right",
            mono ? "font-mono text-[11px]" : "",
            ok === true ? "text-emerald-600 dark:text-emerald-400" : "",
            ok === false ? "font-medium text-red-600 dark:text-red-400" : "",
          ].join(" ")}
        >
          {value}
        </span>
      </div>
      {hint ? (
        <p className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-400">{hint}</p>
      ) : null}
    </div>
  );
}

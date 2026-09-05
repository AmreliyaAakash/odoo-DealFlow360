import { SlidersIcon, UsersThreeIcon } from "@phosphor-icons/react/dist/ssr";
import { currentUser } from "@/lib/auth";
import { formatNumber } from "@/lib/quotations";
import {
  DataTable,
  EmptyRow,
  Notice,
  PageHeader,
  Panel,
  PanelHeader,
  Th,
} from "@/components/dashboard/panel";
import { roleStyle } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { loadManagedUsers } from "../data";
import { requireAdmin } from "../guard";
import { UserRow } from "./user-row";

/**
 * Users & Roles.
 *
 * Two things are editable here: an account's role, and — for anyone who needs
 * more (or less) than their role gives — that account's per-module access. The
 * second is the exception, not the norm: a role change moves everybody who holds
 * it, an override moves one person.
 */
export default async function AdminUsersPage() {
  await requireAdmin();

  const { userId } = await currentUser();
  const { users, loadError } = await loadManagedUsers();

  const custom = users.filter((user) => user.customized).length;

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4">
      <PageHeader
        title="Users & Roles"
        caption="Who can sign in, what they may do, and where that differs from their role"
        badge={`${formatNumber(users.length)} users`}
      />

      {loadError ? <Notice>Could not load users: {loadError}</Notice> : null}

      {/* Both ways of granting unusual access live inside controls on the rows
          below — a dropdown that shows only its selected value, and a link
          named after the dialog it opens. Neither announces that custom access
          is possible at all, so this says it in words above the table. */}
      <Panel delay={60}>
        <PanelHeader
          icon={SlidersIcon}
          title="Giving someone access that their role does not"
          caption="Two ways, depending on whether they belong to a department"
        />

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl bg-muted/40 p-3">
            <p className="text-xs font-medium">Outside every department</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Set their <span className="font-medium text-foreground">Role</span>{" "}
              to <RoleChip>Specialist</RoleChip> in the table below. It grants
              nothing on its own — then open{" "}
              <span className="font-medium text-foreground">Module access</span>{" "}
              on their row and tick exactly what they need.
            </p>
          </div>

          <div className="rounded-xl bg-muted/40 p-3">
            <p className="text-xs font-medium">In a department, with an exception</p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Leave their role alone and open{" "}
              <span className="font-medium text-foreground">Module access</span>{" "}
              to add or remove single modules for that one account. Their row
              then reads{" "}
              <span className="font-medium text-foreground">Custom access</span>.
            </p>
          </div>
        </div>
      </Panel>

      <Panel delay={80}>
        <PanelHeader
          icon={UsersThreeIcon}
          title="Directory"
          caption={
            custom === 0
              ? "Everyone is on their role's default access"
              : `${custom} account${custom === 1 ? " has" : "s have"} access of their own`
          }
        />

        <div className="mt-3">
          <DataTable
            minWidth="52rem"
            head={
              <>
                <Th>Name</Th>
                <Th className="w-52">Email</Th>
                <Th className="w-40">Role</Th>
                <Th className="w-40">Module access</Th>
                <Th className="w-28 text-right">Last active</Th>
              </>
            }
          >
            {users.map((user, index) => (
              <UserRow
                key={user.id}
                user={user}
                index={index}
                isSelf={user.id === userId}
              />
            ))}

            {users.length === 0 && !loadError ? (
              <EmptyRow colSpan={5}>No users yet.</EmptyRow>
            ) : null}
          </DataTable>
        </div>
      </Panel>

      <p className="text-[11px] text-muted-foreground">
        Roles live on the Clerk user as <code>publicMetadata.role</code>. Changing
        one here writes it straight to Clerk; module overrides are stored
        alongside and layered on top when access is resolved.
      </p>
    </main>
  );
}

/**
 * The Specialist badge, styled from the same `roleStyle` the table rows use, so
 * the thing named in the instructions looks like the thing you go on to click.
 */
function RoleChip({ children }: { children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
        roleStyle("specialist"),
      )}
    >
      {children}
    </span>
  );
}

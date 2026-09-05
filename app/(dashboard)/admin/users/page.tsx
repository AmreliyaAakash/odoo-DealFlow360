import { UsersThreeIcon } from "@phosphor-icons/react/dist/ssr";
import {
  DataTable,
  EmptyRow,
  Notice,
  PageHeader,
  Panel,
  PanelHeader,
  Td,
  Th,
  Tr,
} from "@/components/dashboard/panel";
import { formatNumber } from "@/lib/quotations";
import { cn } from "@/lib/utils";
import { loadManagedUsers } from "../data";
import { requireAdmin } from "../guard";

/**
 * Users & Roles. Read-only: roles live on the Clerk user as `publicMetadata.role`
 * and are assigned in the Clerk dashboard, which is also where invites and
 * deletions happen. Showing them here means an admin can audit who holds what
 * without leaving the app.
 */
export default async function AdminUsersPage() {
  await requireAdmin();
  const { users, loadError } = await loadManagedUsers();

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4">
      <PageHeader
        title="Users & Roles"
        caption="Who can sign in, and what each of them may do"
        badge={`${formatNumber(users.length)} users`}
      />

      {loadError ? <Notice>Could not load users: {loadError}</Notice> : null}

      <Panel delay={80}>
        <PanelHeader
          icon={UsersThreeIcon}
          title="Directory"
          caption="Roles are assigned in Clerk under publicMetadata.role"
        />

        <div className="mt-3">
          <DataTable
            minWidth="44rem"
            head={
              <>
                <Th>Name</Th>
                <Th className="w-56">Email</Th>
                <Th className="w-32">Role</Th>
                <Th className="w-32 text-right">Last active</Th>
              </>
            }
          >
            {users.map((user, index) => (
              <Tr
                key={user.id}
                className="df-rise-in"
                style={{ "--df-delay": `${index * 30}ms` } as React.CSSProperties}
              >
                <Td className="font-medium">{user.name}</Td>
                <Td className="text-muted-foreground">{user.email ?? "—"}</Td>
                <Td>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-medium",
                      ROLE_STYLES[user.role ?? "none"] ??
                        "bg-muted text-muted-foreground",
                    )}
                  >
                    {ROLE_LABELS[user.role ?? "none"] ?? user.role}
                  </span>
                </Td>
                <Td className="text-right whitespace-nowrap text-muted-foreground">
                  {user.lastActiveAt
                    ? new Date(user.lastActiveAt).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })
                    : "Never"}
                </Td>
              </Tr>
            ))}

            {users.length === 0 && !loadError ? (
              <EmptyRow colSpan={4}>No users yet.</EmptyRow>
            ) : null}
          </DataTable>
        </div>
      </Panel>
    </main>
  );
}

const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  manager: "Sales Manager",
  finance: "Finance",
  rep: "Sales Rep",
  none: "No role",
};

const ROLE_STYLES: Record<string, string> = {
  admin: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  manager: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  finance: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  rep: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  none: "bg-muted text-muted-foreground",
};

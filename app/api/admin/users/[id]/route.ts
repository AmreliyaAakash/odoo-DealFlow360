import { clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { currentUser, requireRole } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import type { Role } from "@/types/globals";

/**
 * PATCH /api/admin/users/[id] — change one account's role.
 *
 * The role lives on the Clerk user as `publicMetadata.role`; there is no users
 * table to update. Writing it here rather than in the Clerk dashboard is the
 * point of the screen, but it carries two guards worth stating plainly:
 * an admin cannot demote themselves, and the last admin cannot be demoted at
 * all. Either would leave nobody able to hand the access back.
 */

const ASSIGNABLE: Role[] = [
  "admin",
  "manager",
  "finance",
  "rep",
  "specialist",
  "customer",
];

function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ASSIGNABLE as string[]).includes(value);
}

export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/admin/users/[id]">,
) {
  const authorized = await requireRole(["admin"]);
  if (!authorized.ok) return authorized.response;

  const { id } = await ctx.params;
  const { userId: actingUserId } = await currentUser();

  let payload: { role?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isRole(payload.role)) {
    return NextResponse.json(
      { error: `role must be one of: ${ASSIGNABLE.join(", ")}` },
      { status: 400 },
    );
  }
  const nextRole = payload.role;

  const client = await clerkClient();

  let target;
  try {
    target = await client.users.getUser(id);
  } catch {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const currentRoleOfTarget = target.publicMetadata?.role;

  // Locking yourself out is the one mistake this screen must not allow.
  if (id === actingUserId && nextRole !== "admin") {
    return NextResponse.json(
      { error: "You cannot change your own role away from admin" },
      { status: 409 },
    );
  }

  if (currentRoleOfTarget === "admin" && nextRole !== "admin") {
    const remaining = await countAdmins(client);
    if (remaining <= 1) {
      return NextResponse.json(
        { error: "This is the last admin; promote someone else first" },
        { status: 409 },
      );
    }
  }

  const updated = await client.users.updateUserMetadata(id, {
    // Merges at the top level, so any other publicMetadata keys survive.
    publicMetadata: { role: nextRole },
  });

  await recordChange(
    actingUserId,
    id,
    displayName(target),
    String(currentRoleOfTarget ?? ""),
    nextRole,
  );

  return NextResponse.json({
    id: updated.id,
    role: updated.publicMetadata?.role ?? null,
  });
}

/** Clerk cannot filter a count on publicMetadata, so this counts a page. */
async function countAdmins(
  client: Awaited<ReturnType<typeof clerkClient>>,
): Promise<number> {
  const { data } = await client.users.getUserList({ limit: 500 });
  return data.filter((user) => user.publicMetadata?.role === "admin").length;
}

function displayName(user: { firstName: string | null; lastName: string | null; emailAddresses: { emailAddress: string }[]; id: string }) {
  return (
    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
    user.emailAddresses[0]?.emailAddress ||
    user.id
  );
}

/** A role change is a config change, so it belongs in the same audit trail. */
async function recordChange(
  actorId: string | null,
  targetId: string,
  targetName: string,
  from: string,
  to: string,
) {
  if (!actorId) return;

  const supabase = createServerSupabaseClient();
  const actor = await currentUser();

  await supabase.from("config_audit_log").insert({
    actor_id: actorId,
    actor_name: actor.role ? `Admin (${actor.role})` : "Admin",
    entity: "users",
    entity_id: targetId,
    entity_label: targetName,
    action: "update",
    field: "role",
    old_value: from || null,
    new_value: to,
  });
}

import "server-only";
import { clerkClient } from "@clerk/nextjs/server";
import { shortId } from "@/lib/roles";

/**
 * Turning Clerk user IDs into names.
 *
 * Reps, approvers and admins are Clerk users, not database rows, so every screen
 * that shows "who" has to cross the boundary. This was written out separately in
 * the manager dashboard, the report query and the report filters; one copy means
 * one batched call and one fallback behaviour.
 */

/** Clerk pages at 500; a single dashboard never needs more names than that. */
const MAX_LOOKUP = 500;

export type UserSummary = {
  id: string;
  name: string;
  email: string | null;
};

/**
 * Names for the given IDs, batched into one request.
 *
 * A failed lookup returns an empty map rather than throwing: a dashboard with
 * shortened IDs in the name column is worth more than no dashboard, and every
 * caller already falls back to `shortId`.
 */
export async function resolveUserNames(
  userIds: string[],
): Promise<Map<string, string>> {
  const users = await resolveUsers(userIds);
  return new Map([...users].map(([id, user]) => [id, user.name]));
}

/** The same lookup, keeping the email as well. */
export async function resolveUsers(
  userIds: string[],
): Promise<Map<string, UserSummary>> {
  const unique = [...new Set(userIds)].filter(Boolean);
  if (unique.length === 0) return new Map();

  try {
    const client = await clerkClient();
    const { data } = await client.users.getUserList({
      userId: unique,
      limit: Math.min(unique.length, MAX_LOOKUP),
    });

    return new Map(
      data.map((user) => [
        user.id,
        {
          id: user.id,
          name: displayName(user),
          email: user.emailAddresses[0]?.emailAddress ?? null,
        },
      ]),
    );
  } catch {
    return new Map();
  }
}

/** Name, then email, then a shortened id — whichever exists first. */
export function displayName(user: {
  id: string;
  firstName: string | null;
  lastName: string | null;
  emailAddresses: { emailAddress: string }[];
}): string {
  return (
    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
    user.emailAddresses[0]?.emailAddress ||
    shortId(user.id)
  );
}

/** A name for one id, without the caller writing the fallback each time. */
export function nameFor(names: Map<string, string>, id: string): string {
  return names.get(id) ?? shortId(id);
}

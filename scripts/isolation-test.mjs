/**
 * Data-isolation probe.
 *
 * Signs in as each role through the Clerk API, then attacks the endpoints
 * directly — asking for other people's rows, and writing where the role should
 * not be allowed to. Reports what the running app actually did.
 */
import { readFileSync } from "node:fs";

const env = readFileSync(process.argv[2], "utf8");
const SK = env
  .split("\n")
  .find((l) => l.startsWith("CLERK_SECRET_KEY="))
  .split("=")[1]
  .trim();

const BASE = "http://localhost:3000";

const clerk = async (path, init = {}) => {
  const r = await fetch(`https://api.clerk.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${SK}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const t = await r.text();
  return { status: r.status, body: t ? JSON.parse(t) : null };
};

const users = (await clerk("/users?limit=100")).body;
const byEmail = (email) =>
  users.find((u) => u.email_addresses?.[0]?.email_address === email);

const ACCOUNTS = {
  admin: byEmail("codex9600@gmail.com"),
  manager: byEmail("amreliyaaakash3@gmail.com"),
  finance: byEmail("amreliyaaakash05@gmail.com"),
  rep: byEmail("aakashamreliya905@gmail.com"),
  customer: byEmail("localweb0303@gmail.com"),
};

const sessions = [];
const tokens = {};
const sessionByRole = {};

for (const [role, user] of Object.entries(ACCOUNTS)) {
  if (!user) continue;
  const s = await clerk("/sessions", {
    method: "POST",
    body: JSON.stringify({ user_id: user.id }),
  });
  sessions.push(s.body.id);
  sessionByRole[role] = s.body.id;
  const t = await clerk(`/sessions/${s.body.id}/tokens`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  tokens[role] = t.body.jwt;
}

const freshToken = async (role) => {
  const t = await clerk(`/sessions/${sessionByRole[role]}/tokens`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  return t.body?.jwt;
};

const call = async (role, path, init = {}) => {
  const jwt = await freshToken(role);
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    redirect: "manual",
  });
  const text = await r.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 80);
  }
  return { status: r.status, body };
};

const line = (label, verdict, detail = "") =>
  console.log(`  ${verdict.padEnd(6)} ${label}${detail ? ` — ${detail}` : ""}`);

console.log("\n=========== DATA ISOLATION ===========\n");

// 1. A rep must not be able to widen reports to another rep.
console.log("Reports scope (rep asks for the manager's rows):");
{
  const otherId = ACCOUNTS.manager.id;
  const r = await call("rep", `/api/reports?repId=${encodeURIComponent(otherId)}`);
  const echoed = r.body?.filters?.repId;
  const scope = r.body?.scope;
  const pinned = echoed === ACCOUNTS.rep.id;
  line(
    `?repId=<manager> as rep`,
    pinned ? "PASS" : "FAIL",
    `scope=${scope}, query pinned to ${pinned ? "own id" : echoed}`,
  );
}

// 2. A manager is not own-scoped, so the same request is honoured.
{
  const otherId = ACCOUNTS.rep.id;
  const r = await call("manager", `/api/reports?repId=${encodeURIComponent(otherId)}`);
  const echoed = r.body?.filters?.repId;
  line(
    `?repId=<rep> as manager`,
    echoed === otherId ? "PASS" : "FAIL",
    `scope=${r.body?.scope}, repId=${echoed === otherId ? "honoured" : echoed}`,
  );
}

// 3. Admin-only write endpoint, attempted by everyone else.
console.log("\nAdmin user management (PATCH role):");
for (const role of ["rep", "manager", "finance", "customer"]) {
  const r = await call("admin" === role ? "admin" : role, `/api/admin/users/${ACCOUNTS.rep.id}`, {
    method: "PATCH",
    body: JSON.stringify({ role: "admin" }),
  });
  line(
    `${role} tries to make the rep an admin`,
    r.status === 403 || r.status === 401 ? "PASS" : "FAIL",
    `${r.status} ${JSON.stringify(r.body?.error ?? r.body).slice(0, 60)}`,
  );
}

// 4. Approvals are a write for approvers only; a rep may read but not decide.
console.log("\nApproval decisions:");
for (const role of ["rep", "customer"]) {
  const r = await call(role, `/api/quotations/00000000-0000-0000-0000-000000000000/approve`, {
    method: "POST",
    body: JSON.stringify({ action: "approve" }),
  });
  line(
    `${role} tries to approve`,
    r.status === 403 || r.status === 401 ? "PASS" : "FAIL",
    `${r.status} ${JSON.stringify(r.body?.error ?? "").slice(0, 60)}`,
  );
}

// 5. A manager may not act at the finance tier.
{
  const r = await call("manager", `/api/quotations/00000000-0000-0000-0000-000000000000/approve`, {
    method: "POST",
    body: JSON.stringify({ action: "approve", level: 2 }),
  });
  line(
    "manager tries to clear level 2 (finance)",
    r.status === 403 ? "PASS" : "CHECK",
    `${r.status} ${JSON.stringify(r.body?.error ?? "").slice(0, 70)}`,
  );
}

// 6. Config writes are admin-only.
console.log("\nConfig / upsell / warehouse endpoints:");
for (const [role, path, method] of [
  ["rep", "/api/upsell?productId=x", "GET"],
  ["customer", "/api/upsell?productId=x", "GET"],
  ["customer", "/api/warehouse-split", "POST"],
]) {
  const r = await call(role, path, {
    method,
    body: method === "POST" ? JSON.stringify({ lines: [] }) : undefined,
  });
  line(
    `${role} ${method} ${path.split("?")[0]}`,
    r.status < 400 ? "allow" : "deny",
    String(r.status),
  );
}

for (const sid of sessions) {
  await clerk(`/sessions/${sid}/revoke`, { method: "POST", body: JSON.stringify({}) });
}
console.log(`\n${sessions.length} test sessions revoked.\n`);

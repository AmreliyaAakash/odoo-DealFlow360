/**
 * Full access-matrix verification, module by module, role by role.
 *
 * The probe is deliberately non-mutating. Every write attempt carries a body
 * that cannot validate, so the response separates the two things cleanly:
 *
 *   403  the permission gate refused it        -> capability is denied
 *   400  it got past the gate and failed       -> capability is granted
 *   200  it got past the gate and succeeded    -> capability is granted
 *
 * Nothing is created, edited or deleted at any point. That matters because the
 * alternative — sending valid payloads to see what sticks — writes rows into
 * config tables for every allowed cell in a 13x6 matrix.
 *
 * Expected values come from lib/permissions.ts, transcribed here so the test
 * asserts against the specification rather than against the implementation
 * reading its own source.
 *
 *   node scripts/matrix-qa.mjs
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const BASE = "http://localhost:3000";

/** The matrix, from lib/permissions.ts. capability per module per role. */
const EXPECTED = {
  products:          { rep: "view", manager: "view", finance: "view",  customer: "none", admin: "full" },
  discountRules:     { rep: "none", manager: "write", finance: "write", customer: "none", admin: "full" },
  warehouses:        { rep: "none", manager: "none", finance: "full",  customer: "none", admin: "full" },
  subscriptionPlans: { rep: "none", manager: "none", finance: "full",  customer: "none", admin: "full" },
  upsellRules:       { rep: "none", manager: "none", finance: "none",  customer: "none", admin: "full" },
  reports:           { rep: "view", manager: "view", finance: "view",  customer: "none", admin: "full" },
  quotationBuilder:  { rep: "full", manager: "view", finance: "view",  customer: "none", admin: "full" },
  approvals:         { rep: "view", manager: "write", finance: "write", customer: "none", admin: "full" },
  upsellPanel:       { rep: "use",  manager: "none", finance: "none",  customer: "none", admin: "full" },
  warehouseSplit:    { rep: "write", manager: "view", finance: "full", customer: "none", admin: "full" },
  billing:           { rep: "view", manager: "view", finance: "write", customer: "none", admin: "full" },
  dealHealth:        { rep: "view", manager: "view", finance: "view",  customer: "none", admin: "full" },
  customerPortal:    { rep: "write", manager: "none", finance: "none", customer: "full", admin: "none" },
};

const RANK = { none: 0, view: 1, use: 2, write: 3, full: 4 };

/**
 * How to exercise each module. `read` needs `view`; `write` needs `write`.
 * Every write body is invalid on purpose — see the header.
 */
const PROBE = {
  products:          { read: "/api/backend/products",       write: ["POST", "/api/backend/products", {}] },
  discountRules:     { read: "/api/backend/discount-rules", write: ["POST", "/api/backend/discount-rules", {}] },
  warehouses:        { read: "/api/backend/warehouses",     write: ["POST", "/api/backend/warehouses", {}] },
  subscriptionPlans: { read: "/api/backend/subscriptions",  write: ["POST", "/api/backend/subscriptions", {}] },
  upsellRules:       { read: "/api/backend/upsell-rules",   write: ["POST", "/api/backend/upsell-rules", {}] },
  reports:           { read: "/api/reports",                write: null },
  quotationBuilder:  { read: "/api/quotations",             write: ["POST", "/api/quotations", { lines: "not-an-array" }] },
  approvals:         { read: null,                          write: ["POST", "/api/quotations/00000000-0000-0000-0000-000000000000/approve", { action: "nope" }] },
  upsellPanel:       { read: null,                          write: ["POST", "/api/upsell", { lines: "not-an-array" }] },
  warehouseSplit:    { read: null,                          write: ["POST", "/api/warehouse-split", {}] },
  billing:           { read: null,                          write: ["POST", "/api/orders", {}] },
  dealHealth:        { read: null,                          write: ["POST", "/api/deal-health/nudge", {}] },
  customerPortal:    { read: null,                          write: ["POST", "/api/quotations/00000000-0000-0000-0000-000000000000/portal-action", {}] },
};

const sessions = {};
const rows = [];

async function api(page, method, path, body) {
  return page.evaluate(
    async ([method, path, body]) => {
      const res = await fetch(path, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      let parsed = null;
      try { parsed = JSON.parse(await res.text()); } catch { parsed = null; }
      return { status: res.status, error: parsed?.error ?? null };
    },
    [method, path, body ?? null],
  );
}

/* ---------------- connect ---------------- */

console.log("=== sessions ===");
for (const port of [9222, 9223, 9224, 9225, 9226]) {
  try {
    const browser = await chromium.connectOverCDP(`http://localhost:${port}`);
    const ctx = browser.contexts()[0];
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 25000 });
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    const role = await page.evaluate(() => {
      const a = document.querySelector("aside");
      if (!a) return location.pathname.startsWith("/portal") ? "customer" : "unknown";
      const b = a.querySelector(".ring-1.ring-border");
      const t = b ? b.innerText.trim().split("\n").pop() : "";
      return { Admin: "admin", "Sales Manager": "manager", Finance: "finance",
        "Sales Rep": "rep", Customer: "customer" }[t] ?? "unknown";
    });
    sessions[role] = { port, browser, page };
    console.log(`  ${port} -> ${role}`);
  } catch {
    console.log(`  ${port} -> unreachable`);
  }
}

/* ---------------- matrix ---------------- */

console.log("\n=== 13 modules x 5 signed-in roles ===\n");
console.log("module".padEnd(19) + "role".padEnd(10) + "want".padEnd(7) + "read".padEnd(7) + "write".padEnd(8) + "verdict");

for (const [module, byRole] of Object.entries(EXPECTED)) {
  for (const [role, capability] of Object.entries(byRole)) {
    const s = sessions[role];
    if (!s) continue;

    const probe = PROBE[module];
    const canView = RANK[capability] >= RANK.view;
    const canWrite = RANK[capability] >= RANK.write;

    let readStatus = null;
    let readOk = null;
    if (probe.read) {
      const r = await api(s.page, "GET", probe.read);
      readStatus = r.status;
      // A granted read must return 200; a denied one must be 401/403 — never a
      // 200 with an empty body, which is the failure mode this exists to catch.
      readOk = canView ? r.status === 200 : r.status === 403 || r.status === 401;
    }

    let writeStatus = null;
    let writeOk = null;
    if (probe.write) {
      const [method, path, body] = probe.write;
      const w = await api(s.page, method, path, body);
      writeStatus = w.status;
      // 403 = gate refused. Anything else (400 validation, 404 missing row,
      // 409 conflict) means the gate let it through.
      const refused = w.status === 403 || w.status === 401;
      writeOk = canWrite ? !refused : refused;
    }

    const pass = (readOk ?? true) && (writeOk ?? true);
    rows.push({ module, role, capability, readStatus, writeStatus, readOk, writeOk, pass });

    if (!pass) {
      console.log(
        module.padEnd(19) + role.padEnd(10) + capability.padEnd(7) +
        String(readStatus ?? "-").padEnd(7) + String(writeStatus ?? "-").padEnd(8) +
        `FAIL  read=${readOk === null ? "n/a" : readOk} write=${writeOk === null ? "n/a" : writeOk}`,
      );
    }
  }
}

const failed = rows.filter((r) => !r.pass);
console.log(`\n${rows.length} cells probed · ${rows.length - failed.length} pass · ${failed.length} fail`);
if (failed.length === 0) console.log("(no mismatches — nothing listed above)");

writeFileSync("matrix-qa-results.json", JSON.stringify(rows, null, 2));

/* ---------------- scope: can a rep see another rep's deals? ---------------- */

console.log("\n=== scope enforcement (quotationBuilder: rep = own) ===");

if (sessions.rep && sessions.admin) {
  const repList = await sessions.rep.page.evaluate(async () => {
    const r = await fetch("/api/quotations");
    const j = await r.json().catch(() => ({}));
    const q = j.quotations ?? j.rows ?? [];
    return { n: q.length, reps: [...new Set(q.map((x) => x.rep_id))] };
  });
  const adminList = await sessions.admin.page.evaluate(async () => {
    const r = await fetch("/api/quotations");
    const j = await r.json().catch(() => ({}));
    const q = j.quotations ?? j.rows ?? [];
    return { n: q.length, reps: [...new Set(q.map((x) => x.rep_id))] };
  });

  console.log(`  rep sees   ${repList.n} quotations from ${repList.reps.length} rep id(s)`);
  console.log(`  admin sees ${adminList.n} quotations from ${adminList.reps.length} rep id(s)`);
  const scoped = repList.reps.length <= 1 && repList.n <= adminList.n;
  console.log(`  rep is scoped to own rows: ${scoped ? "PASS" : "FAIL — rep sees more than one rep's deals"}`);
}

/* ---------------- unauthenticated ---------------- */

console.log("\n=== no session at all ===");
for (const path of ["/api/quotations", "/api/reports", "/api/backend/warehouses"]) {
  const res = await fetch(`${BASE}${path}`);
  const loud = res.status === 401 || res.status === 403 || res.status === 307 || res.status === 302;
  console.log(`  ${path.padEnd(28)} ${res.status}  ${loud ? "PASS (refused)" : "FAIL (served without a session)"}`);
}

for (const s of Object.values(sessions)) await s.browser.close();

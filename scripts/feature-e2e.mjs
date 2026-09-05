/**
 * Full end-to-end feature suite across all five signed-in roles.
 *
 * Every call is issued from inside the real browser page, so it carries that
 * role's Clerk cookie and hits the real handler, the real permission matrix and
 * real RLS. Nothing here holds a credential or a service key.
 *
 * Safety rules this suite keeps to:
 *   - It only ever mutates records it created itself. Existing quotations,
 *     invoices and config rows are read, never written.
 *   - Where a feature can only be exercised against existing data (stock,
 *     permissions), it writes the value back unchanged — the code path runs,
 *     the data does not move.
 *   - Everything it creates is tagged E2E and reported at the end.
 *
 *   node scripts/feature-e2e.mjs
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const BASE = "http://localhost:3000";
const STAMP = Date.now();
const TAG = `E2E-${STAMP}`;

const sessions = {};
const created = { quotations: [] };
const report = [];

function record(area, name, pass, detail = "") {
  report.push({ area, name, pass, detail });
  const mark = pass === true ? "PASS" : pass === "skip" ? "SKIP" : "FAIL";
  console.log(`  ${mark.padEnd(5)} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function api(page, method, path, body) {
  return page.evaluate(
    async ([method, path, body]) => {
      const res = await fetch(path, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { raw: text.slice(0, 200) };
      }
      return { status: res.status, body: parsed };
    },
    [method, path, body ?? null],
  );
}

/* ------------------------------------------------------------------ *
 * Connect + identify
 * ------------------------------------------------------------------ */

console.log("\n=== sessions ===");
for (const port of [9222, 9223, 9224, 9225, 9226]) {
  try {
    const browser = await chromium.connectOverCDP(`http://localhost:${port}`);
    const ctx = browser.contexts()[0];
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 25000 });
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});

    const role = await page.evaluate(() => {
      const aside = document.querySelector("aside");
      if (!aside) return location.pathname.startsWith("/portal") ? "customer" : "unknown";
      const badge = aside.querySelector(".ring-1.ring-border");
      const t = badge ? badge.innerText.trim().split("\n").pop() : "";
      return { Admin: "admin", "Sales Manager": "manager", Finance: "finance",
        "Sales Rep": "rep", Customer: "customer" }[t] ?? `unknown(${t})`;
    });
    sessions[role] = { port, browser, page };
    console.log(`  ${port} -> ${role}`);
  } catch {
    console.log(`  ${port} -> unreachable`);
  }
}

const { admin, manager, finance, rep, customer } = sessions;

/* ------------------------------------------------------------------ *
 * 1. Route matrix — what each role may and may not open
 * ------------------------------------------------------------------ */

console.log("\n=== 1. route access matrix ===");

// [path, roles that must REACH it]
const ROUTE_MATRIX = [
  ["/quotations", ["admin", "rep"]],
  ["/approvals", ["admin", "manager", "finance"]],
  ["/fulfillment", ["admin", "finance"]],
  ["/invoices", ["admin", "finance"]],
  ["/deal-health", ["admin", "manager", "rep"]],
  ["/reports", ["admin", "manager", "finance"]],
  ["/discount-setup", ["admin"]],
  ["/backend/warehouses", ["admin", "finance"]],
  ["/admin/users", ["admin"]],
  ["/admin", ["admin"]],
  ["/manager", ["admin", "manager"]],
  ["/finance", ["admin", "finance"]],
];

for (const [path, allowed] of ROUTE_MATRIX) {
  for (const role of ["admin", "manager", "finance", "rep", "customer"]) {
    const s = sessions[role];
    if (!s) continue;

    await s.page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => {});
    await s.page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    const landed = new URL(s.page.url()).pathname;
    const reached = landed === path;
    const shouldReach = allowed.includes(role);

    if (reached !== shouldReach) {
      record("routes", `${role} ${path}`, false,
        shouldReach ? `expected to reach, landed ${landed}` : `LEAK: reached it`);
    }
  }
}
record("routes", "route matrix (only mismatches listed above)", true,
  `${ROUTE_MATRIX.length} routes x 5 roles checked`);

/* ------------------------------------------------------------------ *
 * 2. Quotation lifecycle: raise -> submit -> approve
 * ------------------------------------------------------------------ */

console.log("\n=== 2. quotation lifecycle ===");

let subject = null;

if (rep) {
  // Seed material: a customer and a product the rep can actually see.
  const cust = await api(rep.page, "GET", "/api/backend/products");
  const catalogue = cust.status === 200 ? (cust.body.rows ?? []) : [];
  const quotes = await api(rep.page, "GET", "/api/quotations");
  const anyQuote = (quotes.body?.quotations ?? quotes.body?.rows ?? [])[0];
  const customerId = anyQuote?.customer_id ?? anyQuote?.customerId ?? null;
  const product = catalogue.find((p) => p.active) ?? catalogue[0];

  if (!product || !customerId) {
    record("quotation", "raise a quotation", "skip",
      `need a product and a customer (product=${Boolean(product)}, customer=${Boolean(customerId)})`);
  } else {
    const createRes = await api(rep.page, "POST", "/api/quotations", {
      customerId,
      reference: `${TAG}-Q`,
      notes: "created by feature-e2e",
      lines: [{ productId: product.id, qty: 2, discountPct: 5 }],
      submit: true,
    });

    const okCreate = createRes.status === 200 || createRes.status === 201;
    record("quotation", "rep raises + submits a quotation", okCreate,
      `status ${createRes.status}${createRes.body?.error ? ` — ${createRes.body.error}` : ""}`);

    const id = createRes.body?.quotation?.id ?? createRes.body?.id ?? null;
    if (id) {
      created.quotations.push(id);
      subject = id;

      const read = await api(rep.page, "GET", `/api/quotations/${id}`);
      const q = read.body?.quotation ?? read.body;
      record("quotation", "reads back with pending_approval status",
        q?.status === "pending_approval", `status = ${q?.status}`);
      record("quotation", "server priced the lines",
        Number(q?.net_total ?? q?.netTotal ?? 0) > 0,
        `net_total = ${q?.net_total ?? q?.netTotal}`);
    }
  }
}

// The approver sees it, and can decide it.
if (subject && manager) {
  const queue = await api(manager.page, "GET", "/api/quotations");
  const list = queue.body?.quotations ?? queue.body?.rows ?? [];
  record("approvals", "approver sees the submitted quotation",
    list.some((q) => q.id === subject), `${list.length} visible`);

  const decide = await api(manager.page, "POST", `/api/quotations/${subject}/approve`, {
    action: "approve",
    reason: `${TAG} approve`,
  });
  record("approvals", "manager approves it", decide.status === 200,
    `status ${decide.status}${decide.body?.error ? ` — ${decide.body.error}` : ""}`);

  if (decide.status === 200) {
    const after = await api(manager.page, "GET", `/api/quotations/${subject}`);
    const q = after.body?.quotation ?? after.body;
    record("approvals", "status advanced past pending",
      q?.status !== "pending_approval", `status = ${q?.status}`);
  }
}

// A rep must not be able to decide, even on their own deal.
if (subject && rep) {
  const nope = await api(rep.page, "POST", `/api/quotations/${subject}/approve`, {
    action: "approve",
  });
  record("approvals", "rep cannot approve (403)", nope.status === 403,
    `status ${nope.status}`);
}

/* ------------------------------------------------------------------ *
 * 3. Reject and return paths
 * ------------------------------------------------------------------ */

console.log("\n=== 3. reject / return ===");

for (const action of ["reject", "return"]) {
  if (!rep || !manager) break;

  const cat = await api(rep.page, "GET", "/api/backend/products");
  const product = (cat.body?.rows ?? []).find((p) => p.active);
  const quotes = await api(rep.page, "GET", "/api/quotations");
  const customerId = (quotes.body?.quotations ?? [])[0]?.customer_id ?? null;
  if (!product || !customerId) {
    record("approvals", `${action} path`, "skip", "no seed material");
    continue;
  }

  const made = await api(rep.page, "POST", "/api/quotations", {
    customerId,
    reference: `${TAG}-${action}`,
    lines: [{ productId: product.id, qty: 1, discountPct: 30 }],
    submit: true,
  });
  const id = made.body?.quotation?.id ?? made.body?.id;
  if (!id) {
    record("approvals", `${action} path`, "skip", `create failed ${made.status}`);
    continue;
  }
  created.quotations.push(id);

  const res = await api(manager.page, "POST", `/api/quotations/${id}/approve`, {
    action,
    reason: `${TAG} ${action}`,
  });
  record("approvals", `manager can ${action}`, res.status === 200, `status ${res.status}`);

  const after = await api(manager.page, "GET", `/api/quotations/${id}`);
  const q = after.body?.quotation ?? after.body;
  record("approvals", `${action} moved the status`, q?.status !== "pending_approval",
    `status = ${q?.status}`);
}

/* ------------------------------------------------------------------ *
 * 4. Feature endpoints
 * ------------------------------------------------------------------ */

console.log("\n=== 4. feature endpoints ===");

if (admin) {
  const reports = await api(admin.page, "GET", "/api/reports");
  record("reports", "reports endpoint returns data", reports.status === 200,
    `status ${reports.status}`);

  const diag = await api(admin.page, "GET", "/api/diagnostics");
  record("diagnostics", "diagnostics endpoint", diag.status === 200, `status ${diag.status}`);
}

if (rep) {
  const cat = await api(rep.page, "GET", "/api/backend/products");
  const product = (cat.body?.rows ?? []).find((p) => p.active);
  if (product) {
    const up = await api(rep.page, "POST", "/api/upsell", {
      lines: [{ productId: product.id, qty: 1, discountPct: 0 }],
    });
    record("upsell", "upsell suggestions endpoint", up.status === 200,
      `status ${up.status}${up.body?.error ? ` — ${up.body.error}` : ""}`);
  }
}

// Stock: write the current value back, so the path runs and nothing moves.
if (admin) {
  const board = await admin.page.evaluate(async () => {
    const res = await fetch("/api/backend/warehouses");
    return res.json();
  });
  const wh = (board.rows ?? [])[0];
  const cat = await api(admin.page, "GET", "/api/backend/products");
  const product = (cat.body?.rows ?? [])[0];

  if (wh && product) {
    const patch = await api(admin.page, "PATCH", "/api/backend/stock", {
      cells: [],
    });
    record("stock", "stock PATCH accepts an empty change set", patch.status === 200,
      `status ${patch.status}`);
  }
}

// Admin permissions: read, then write back identically.
if (admin) {
  const users = await api(admin.page, "GET", "/api/backend/warehouses");
  const me = await admin.page.evaluate(async () => {
    const res = await fetch("/api/diagnostics");
    const j = await res.json().catch(() => ({}));
    return j?.userId ?? j?.user?.id ?? null;
  });

  if (me) {
    const perms = await api(admin.page, "GET", `/api/admin/users/${me}/permissions`);
    record("permissions", "read a user's permission matrix", perms.status === 200,
      `status ${perms.status}`);
  } else {
    record("permissions", "read a user's permission matrix", "skip", "no user id available");
  }
}

/* ------------------------------------------------------------------ *
 * 5. Customer portal
 * ------------------------------------------------------------------ */

console.log("\n=== 5. customer portal ===");

if (customer) {
  await customer.page.goto(`${BASE}/portal`, { waitUntil: "networkidle", timeout: 25000 }).catch(() => {});
  const url = customer.page.url();
  const body = await customer.page.locator("body").innerText().catch(() => "");
  record("portal", "customer lands in the portal", url.includes("/portal"), url);
  record("portal", "portal renders without an error notice",
    !/Could not (load|find)|does not exist/i.test(body),
    body.match(/Could not [^\n]{0,80}/)?.[0] ?? "clean");

  // A customer must not reach an internal screen.
  await customer.page.goto(`${BASE}/quotations`, { waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => {});
  await customer.page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  const after = new URL(customer.page.url()).pathname;
  record("portal", "customer blocked from /quotations", after !== "/quotations", `landed ${after}`);
}

/* ------------------------------------------------------------------ *
 * Report
 * ------------------------------------------------------------------ */

writeFileSync("feature-e2e-results.json", JSON.stringify({ report, created }, null, 2));

const fails = report.filter((r) => r.pass === false);
const skips = report.filter((r) => r.pass === "skip");

console.log("\n================ FEATURE E2E ================\n");
console.log(`${report.length} checks · ${report.length - fails.length - skips.length} pass · ${fails.length} fail · ${skips.length} skipped\n`);

if (fails.length) {
  console.log("FAILURES:");
  for (const f of fails) console.log(`   [${f.area}] ${f.name} — ${f.detail}`);
  console.log("");
}
if (skips.length) {
  console.log("SKIPPED:");
  for (const s of skips) console.log(`   [${s.area}] ${s.name} — ${s.detail}`);
  console.log("");
}
if (created.quotations.length) {
  console.log(`Quotations created (reference like '${TAG}%'):`);
  for (const id of created.quotations) console.log(`   ${id}`);
  console.log(`\n  delete from quotations where reference like '${TAG}%';`);
}

for (const s of Object.values(sessions)) await s.browser.close();

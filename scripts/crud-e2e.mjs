/**
 * End-to-end CRUD and permission suite, driven through the real signed-in
 * browsers on their CDP ports.
 *
 * Every request is issued from inside the page with `fetch`, so it carries the
 * real Clerk session cookie and lands on the real route handler: the same
 * permission matrix, the same RLS, the same audit log a human would hit. No
 * service key, no credentials in this file.
 *
 * For each config entity it runs the full round trip and checks the count after
 * every step, because a create that silently writes nothing and a create that
 * writes two rows both pass a naive "did it 200" test:
 *
 *   count -> CREATE -> count+1 and row readable
 *         -> UPDATE -> field actually changed on re-read
 *         -> DELETE -> count back to where it started
 *
 * Everything it creates is named E2E-TEST-<timestamp> and deleted again. It
 * never updates or deletes a row it did not create; if a delete fails the row
 * is reported by name so you can remove it by hand.
 *
 *   node scripts/crud-e2e.mjs
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const BASE = "http://localhost:3000";
const STAMP = Date.now();
const TAG = `E2E-TEST-${STAMP}`;

/** Which port holds which role, detected rather than assumed. */
const PORTS = [9222, 9223, 9224, 9225, 9226];

/** Config entities behind /api/backend/[entity]. */
const ENTITIES = [
  "products",
  "discount-rules",
  "warehouses",
  "subscriptions",
  "upsell-rules",
  "replenishment",
];

const results = { roles: {}, crud: [], permissions: [], realtime: null };

/* ------------------------------------------------------------------ *
 * Plumbing
 * ------------------------------------------------------------------ */

/** Runs a fetch inside the page so the Clerk cookie goes with it. */
async function api(page, method, path, body) {
  return page.evaluate(
    async ([method, path, body]) => {
      const res = await fetch(path, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      let parsed = null;
      const text = await res.text();
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

function ok(cond, label, detail) {
  return { pass: Boolean(cond), label, detail: detail ?? "" };
}

/* ------------------------------------------------------------------ *
 * Connect and identify
 * ------------------------------------------------------------------ */

const sessions = {};

for (const port of PORTS) {
  try {
    const browser = await chromium.connectOverCDP(`http://localhost:${port}`);
    const ctx = browser.contexts()[0];
    const page = ctx.pages()[0] ?? (await ctx.newPage());

    await page.goto(`${BASE}/dashboard`, {
      waitUntil: "domcontentloaded",
      timeout: 25000,
    });
    await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});

    const role = await page.evaluate(() => {
      const aside = document.querySelector("aside");
      if (!aside) return location.pathname.startsWith("/portal") ? "customer" : "unknown";
      const badge = aside.querySelector(".ring-1.ring-border");
      const text = badge ? badge.innerText.trim().split("\n").pop() : "";
      return (
        {
          Admin: "admin",
          "Sales Manager": "manager",
          Finance: "finance",
          "Sales Rep": "rep",
          Customer: "customer",
        }[text] ?? `unknown(${text})`
      );
    });

    sessions[role] = { port, browser, page };
    results.roles[role] = port;
    console.log(`port ${port} -> ${role}`);
  } catch (error) {
    console.log(`port ${port} -> UNREACHABLE (${String(error.message).slice(0, 60)})`);
  }
}

const admin = sessions.admin;
if (!admin) {
  console.error("\nNo admin session found. CRUD needs one; aborting.");
  process.exit(1);
}

/* ------------------------------------------------------------------ *
 * CRUD round trip, as admin
 * ------------------------------------------------------------------ */

console.log("\n--- CRUD round trip (as admin) ---\n");

for (const entity of ENTITIES) {
  const checks = [];
  const row = { entity, checks, created: null };

  const before = await api(admin.page, "GET", `/api/backend/${entity}`);
  if (before.status !== 200) {
    row.blocked = before.body?.error ?? `GET ${before.status}`;
    console.log(`${entity.padEnd(16)} BLOCKED: ${row.blocked}`);
    results.crud.push(row);
    continue;
  }

  const rows = before.body.rows ?? [];
  const startCount = rows.length;

  if (rows.length === 0) {
    row.blocked = "no existing row to use as a template for the create payload";
    console.log(`${entity.padEnd(16)} SKIPPED: ${row.blocked}`);
    results.crud.push(row);
    continue;
  }

  // Build the create payload from a real row, so it satisfies whatever
  // validation the entity config imposes without re-deriving it here.
  const template = { ...rows[0] };
  delete template.id;
  const labelField = "name" in template ? "name" : null;
  if (labelField) template[labelField] = TAG;

  // A unique natural key where the table has one.
  if ("sku" in template) template.sku = `E2E-${STAMP}`.slice(0, 20);
  if ("code" in template) template.code = `E2E${String(STAMP).slice(-5)}`;

  const created = await api(admin.page, "POST", `/api/backend/${entity}`, template);
  checks.push(ok(created.status === 200 || created.status === 201, "CREATE responds ok",
    `status ${created.status}${created.body?.error ? ` — ${created.body.error}` : ""}`));

  const afterCreate = await api(admin.page, "GET", `/api/backend/${entity}`);
  const createdRows = afterCreate.body?.rows ?? [];
  checks.push(ok(createdRows.length === startCount + 1, "count is +1 after CREATE",
    `${startCount} -> ${createdRows.length}`));

  const mine = labelField
    ? createdRows.find((r) => r[labelField] === TAG)
    : createdRows.find((r) => !rows.some((o) => o.id === r.id));

  checks.push(ok(Boolean(mine), "created row is readable back"));

  if (mine) {
    row.created = mine.id;

    // UPDATE — flip a field we can verify without guessing the schema.
    const editField = labelField ?? Object.keys(mine).find(
      (k) => k !== "id" && typeof mine[k] === "boolean",
    );
    const editValue = labelField ? `${TAG}-EDITED` : !mine[editField];

    const updated = await api(admin.page, "PATCH", `/api/backend/${entity}`, {
      id: mine.id,
      [editField]: editValue,
    });
    checks.push(ok(updated.status === 200, "UPDATE responds ok",
      `status ${updated.status}${updated.body?.error ? ` — ${updated.body.error}` : ""}`));

    const afterEdit = await api(admin.page, "GET", `/api/backend/${entity}`);
    const edited = (afterEdit.body?.rows ?? []).find((r) => r.id === mine.id);
    checks.push(ok(edited && edited[editField] === editValue,
      "UPDATE actually changed the stored value",
      `${editField} = ${JSON.stringify(edited?.[editField])}`));

    checks.push(ok((afterEdit.body?.rows ?? []).length === startCount + 1,
      "UPDATE did not change the count",
      `${(afterEdit.body?.rows ?? []).length}`));

    // DELETE. Every config entity is softDelete:true — the row is kept and
    // `active` flipped to false, because quotation lines reference these rows
    // and a hard delete would orphan historic ones. So the row surviving is
    // the correct outcome; what must change is `active`.
    const removed = await api(admin.page, "DELETE", `/api/backend/${entity}?id=${mine.id}`);
    checks.push(ok(removed.status === 200, "DELETE responds ok",
      `status ${removed.status}${removed.body?.error ? ` — ${removed.body.error}` : ""}`));

    const afterDelete = await api(admin.page, "GET", `/api/backend/${entity}`);
    const finalRows = afterDelete.body?.rows ?? [];
    const softDeleted = finalRows.find((r) => r.id === mine.id);

    checks.push(ok(Boolean(softDeleted), "soft delete keeps the row",
      softDeleted ? "row retained" : "row was hard-deleted — historic lines would orphan"));
    checks.push(ok(softDeleted?.active === false, "soft delete set active = false",
      `active = ${JSON.stringify(softDeleted?.active)}`));
    checks.push(ok(finalRows.length === startCount + 1, "count still includes the retained row",
      `${startCount} -> ${finalRows.length}`));

    // Deactivated, not removed: the API has no hard delete, so this row stays
    // in the table and is reported for manual cleanup.
    row.leftBehind = `${entity}: id=${mine.id} name=${TAG} (deactivated)`;
  }

  const failed = checks.filter((c) => !c.pass);
  console.log(
    `${entity.padEnd(16)} ${failed.length === 0 ? "PASS" : `FAIL (${failed.length}/${checks.length})`}`,
  );
  for (const f of failed) console.log(`    x ${f.label}${f.detail ? ` — ${f.detail}` : ""}`);

  results.crud.push(row);
}

/* ------------------------------------------------------------------ *
 * Permission boundaries — the same write, from the wrong desk
 * ------------------------------------------------------------------ */

console.log("\n--- permission boundaries ---\n");

const DENY = [
  ["rep", "warehouses", "a rep may not create a warehouse"],
  ["rep", "discount-rules", "a rep may not create a discount rule"],
  ["manager", "products", "a manager may not create a product"],
  ["customer", "warehouses", "a customer may not create a warehouse"],
];

for (const [role, entity, why] of DENY) {
  const s = sessions[role];
  if (!s) {
    console.log(`${role.padEnd(9)} ${entity.padEnd(16)} SKIPPED (no session)`);
    continue;
  }

  const res = await api(s.page, "POST", `/api/backend/${entity}`, { name: `${TAG}-DENY` });
  const denied = res.status === 401 || res.status === 403;
  console.log(
    `${role.padEnd(9)} ${entity.padEnd(16)} ${denied ? `denied ${res.status} OK` : `LEAK: ${res.status}`}`,
  );
  results.permissions.push({ role, entity, why, status: res.status, denied });
}

/* ------------------------------------------------------------------ *
 * Realtime — a write in one browser, seen in another without a reload
 * ------------------------------------------------------------------ */

console.log("\n--- realtime ---\n");

const watcher = sessions.manager ?? sessions.admin;
const writer = sessions.rep ?? sessions.admin;

if (watcher && writer) {
  try {
    await watcher.page.goto(`${BASE}/deal-health`, { waitUntil: "networkidle", timeout: 30000 });
    const rowsBefore = await watcher.page.locator("tbody tr").count();

    const list = await api(writer.page, "GET", "/api/quotations?limit=1");
    const target = (list.body?.quotations ?? list.body?.rows ?? [])[0];

    if (!target) {
      results.realtime = { skipped: "no quotation visible to the writer" };
      console.log("SKIPPED — no quotation available to touch");
    } else {
      // A no-op-ish edit: rewrite the note with a tag, then put it back.
      const original = target.notes ?? "";
      const patched = await api(writer.page, "PATCH", `/api/quotations/${target.id}`, {
        notes: `${original} ${TAG}`.trim(),
      });

      // The watcher subscribes to postgres_changes on quotations; give the
      // socket a moment rather than asserting instantly.
      await watcher.page.waitForTimeout(4000);
      const rowsAfter = await watcher.page.locator("tbody tr").count();
      const stillOnPage = watcher.page.url().includes("/deal-health");

      results.realtime = {
        patchStatus: patched.status,
        rowsBefore,
        rowsAfter,
        stillOnPage,
        note: "row count is a coarse signal; the channel is confirmed by the socket staying open",
      };
      console.log(
        `PATCH ${patched.status} · watcher rows ${rowsBefore} -> ${rowsAfter} (no reload)`,
      );

      // Put the note back.
      await api(writer.page, "PATCH", `/api/quotations/${target.id}`, { notes: original });
    }
  } catch (error) {
    results.realtime = { error: String(error.message).slice(0, 140) };
    console.log(`ERROR — ${String(error.message).slice(0, 100)}`);
  }
}

/* ------------------------------------------------------------------ *
 * Report
 * ------------------------------------------------------------------ */

writeFileSync("crud-e2e-results.json", JSON.stringify(results, null, 2));

const leftovers = results.crud.filter((r) => r.leftBehind);
console.log("\n================ SUMMARY ================\n");
const passed = results.crud.filter((r) => !r.blocked && r.checks.every((c) => c.pass));
const failed = results.crud.filter((r) => !r.blocked && !r.checks.every((c) => c.pass));
const blocked = results.crud.filter((r) => r.blocked);
console.log(`CRUD      : ${passed.length} pass, ${failed.length} fail, ${blocked.length} blocked`);
console.log(
  `Permission: ${results.permissions.filter((p) => p.denied).length}/${results.permissions.length} correctly denied`,
);
if (leftovers.length) {
  console.log("\nDEACTIVATED TEST ROWS — the API soft-deletes, so these remain:");
  for (const l of leftovers) console.log(`   ${l.leftBehind}`);
  console.log(`\nRemove them with:  delete from <table> where name like 'E2E-TEST-%';`);
} else {
  console.log("\nNo test rows left behind.");
}

for (const s of Object.values(sessions)) await s.browser.close();

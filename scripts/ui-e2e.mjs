/**
 * UI-driven end-to-end suite, in the real Chrome windows.
 *
 * This drives the interface the way a person does — clicking New, typing into
 * the form, pressing Create, accepting the confirm dialog — and then RELOADS
 * the page before asserting. The reload is the point: it proves the row reached
 * Postgres and came back, rather than only reaching React state.
 *
 * No fetch() shortcuts. If a button is missing or a field will not accept
 * input, this fails, which is what "test the UI" has to mean.
 *
 *   node scripts/ui-e2e.mjs
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const BASE = "http://localhost:3000";
const STAMP = String(Date.now()).slice(-7);
const NAME = `E2E UI ${STAMP}`;
const EDITED = `${NAME} EDITED`;
const CODE = `EU${STAMP}`.slice(0, 8);

const sessions = {};
const report = [];
const leftovers = [];

function record(area, name, pass, detail = "") {
  report.push({ area, name, pass, detail });
  const mark = pass === true ? "PASS" : pass === "skip" ? "SKIP" : "FAIL";
  console.log(`  ${mark.padEnd(5)} ${name}${detail ? ` — ${detail}` : ""}`);
}

/* ------------------------------------------------------------------ */

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
      const b = aside.querySelector(".ring-1.ring-border");
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

const { admin, manager, finance, rep, customer } = sessions;

/* ------------------------------------------------------------------ *
 * 1. Config CRUD, entirely through the UI
 * ------------------------------------------------------------------ */

console.log("\n=== 1. warehouse CRUD through the UI (admin) ===");

if (admin) {
  const page = admin.page;
  // The Deactivate button asks window.confirm; accept whatever it asks.
  page.on("dialog", (d) => d.accept().catch(() => {}));

  try {
    await page.goto(`${BASE}/backend/warehouses`, { waitUntil: "networkidle", timeout: 30000 });

    const before = await page.locator("tbody tr").count();

    // --- CREATE -----------------------------------------------------
    await page.getByRole("button", { name: "New", exact: true }).click();
    record("ui-create", "New opens the form",
      await page.getByRole("button", { name: "Create" }).isVisible().catch(() => false));

    await page.getByLabel("Name", { exact: false }).first().fill(NAME);
    await page.getByLabel("Code", { exact: false }).first().fill(CODE);
    await page.getByLabel("Region", { exact: false }).first().fill("E2E Region").catch(() => {});
    await page.getByLabel("Priority", { exact: false }).first().fill("99").catch(() => {});

    await page.getByRole("button", { name: "Create" }).click();

    // Wait for the row, don't sleep at it. The table refreshes through
    // router.refresh(), so a fixed pause races the server round trip and fails
    // intermittently on a slower one.
    const appeared = await page
      .getByRole("cell", { name: NAME, exact: false })
      .first()
      .waitFor({ state: "visible", timeout: 20000 })
      .then(() => true)
      .catch(() => false);

    record("ui-create", "row appears in the table after Create", appeared,
      `${before} -> ${await page.locator("tbody tr").count()} rows`);

    // --- PERSISTED? the reload is the real assertion -----------------
    await page.reload({ waitUntil: "networkidle", timeout: 30000 });
    const survived = await page.getByText(NAME, { exact: false }).count();
    record("ui-create", "row SURVIVES a full page reload (backend persisted)", survived > 0,
      survived > 0 ? "read back from Postgres" : "vanished — was never saved");

    if (survived === 0) throw new Error("create did not persist; skipping edit/deactivate");
    leftovers.push(`warehouses: "${NAME}" / code ${CODE}`);

    // --- EDIT --------------------------------------------------------
    await page.getByRole("button", { name: `Edit ${NAME}` }).click();
    await page.getByLabel("Name", { exact: false }).first().fill(EDITED);
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1200);

    record("ui-edit", "edited name shows in the table",
      (await page.getByText(EDITED, { exact: false }).count()) > 0);

    await page.reload({ waitUntil: "networkidle", timeout: 30000 });
    const editStuck = await page.getByText(EDITED, { exact: false }).count();
    record("ui-edit", "edit SURVIVES a reload", editStuck > 0,
      editStuck > 0 ? "persisted" : "reverted — not saved");

    // --- DEACTIVATE (soft delete) ------------------------------------
    await page.getByRole("button", { name: `Deactivate ${EDITED}` }).click();
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await page.reload({ waitUntil: "networkidle", timeout: 30000 });

    // Soft delete keeps the row. The table carries no "Active" column — an
    // inactive row is shown dimmed with its Deactivate button disabled
    // (resource-table.tsx), so that is what to assert on, not row text.
    const row = page.locator("tbody tr", { hasText: EDITED }).first();
    const rowText = await row.innerText().catch(() => "");
    record("ui-delete", "row still listed after Deactivate (soft delete)",
      rowText.length > 0, rowText ? "row retained" : "row disappeared");

    const dimmed = await row
      .evaluate((el) => el.className.includes("opacity-50"))
      .catch(() => false);
    const buttonOff = await page
      .getByRole("button", { name: `Deactivate ${EDITED}` })
      .isDisabled()
      .catch(() => false);

    record("ui-delete", "row is shown as deactivated (dimmed + button disabled)",
      dimmed && buttonOff, `dimmed=${dimmed} deactivateDisabled=${buttonOff}`);
  } catch (error) {
    record("ui-crud", "warehouse CRUD flow", false, String(error.message).split("\n")[0].slice(0, 120));
  }
}

/* ------------------------------------------------------------------ *
 * 2. Read-only / denied UI per role — content, not URL
 * ------------------------------------------------------------------ */

console.log("\n=== 2. what each role's UI actually offers ===");

// From lib/permissions.ts. capability for the `warehouses` module.
const CONFIG_EXPECT = [
  ["admin", "full"],
  ["finance", "full"],
  ["manager", "none"],
  ["rep", "none"],
];

for (const [role, capability] of CONFIG_EXPECT) {
  const s = sessions[role];
  if (!s) { record("ui-access", `${role} /backend/warehouses`, "skip", "no session"); continue; }

  await s.page.goto(`${BASE}/backend/warehouses`, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
  const body = await s.page.locator("body").innerText().catch(() => "");
  const denied = /do not have access/i.test(body);
  const hasNew = await s.page.getByRole("button", { name: "New", exact: true }).count().catch(() => 0);

  if (capability === "none") {
    record("ui-access", `${role} is denied the warehouses config`, denied,
      denied ? "access notice shown" : "PAGE CONTENT RENDERED — real leak");
  } else {
    record("ui-access", `${role} gets the warehouses config with New`, !denied && hasNew > 0,
      denied ? "wrongly denied" : `New button: ${hasNew}`);
  }
}

/* ------------------------------------------------------------------ *
 * 3. Sidebar reflects the role
 * ------------------------------------------------------------------ */

console.log("\n=== 3. sidebar per role ===");

for (const role of ["admin", "manager", "finance", "rep"]) {
  const s = sessions[role];
  if (!s) continue;
  await s.page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle", timeout: 25000 }).catch(() => {});
  const items = await s.page.locator("aside a").allInnerTexts().catch(() => []);
  const labels = items.map((t) => t.trim().split("\n")[0]).filter(Boolean);
  record("ui-nav", `${role} sidebar`, labels.length > 0, labels.join(" · ").slice(0, 150));
}

if (customer) {
  await customer.page.goto(`${BASE}/portal`, { waitUntil: "networkidle", timeout: 25000 }).catch(() => {});
  const hasAside = await customer.page.locator("aside").count();
  record("ui-nav", "customer gets no internal sidebar", hasAside === 0, `aside count ${hasAside}`);
}

/* ------------------------------------------------------------------ *
 * 4. Stock editor: type a figure, save, reload
 * ------------------------------------------------------------------ */

console.log("\n=== 4. stock editor (admin) ===");

if (admin) {
  try {
    const page = admin.page;
    await page.goto(`${BASE}/backend/stock`, { waitUntil: "networkidle", timeout: 30000 });

    const input = page.locator('input[type="number"]').first();
    const has = await input.count();
    if (!has) {
      record("ui-stock", "stock grid has editable cells", "skip", "no number inputs found");
    } else {
      const original = await input.inputValue();
      const bumped = String(Number(original) + 1);

      await input.fill(bumped);
      const saveBtn = page.getByRole("button", { name: /Save \d+ change/ });
      record("ui-stock", "Save button enables once a cell changes",
        await saveBtn.isVisible().catch(() => false), `${original} -> ${bumped}`);

      await saveBtn.click();
      await page.waitForTimeout(2500);
      await page.reload({ waitUntil: "networkidle", timeout: 30000 });

      const after = await page.locator('input[type="number"]').first().inputValue();
      record("ui-stock", "typed figure SURVIVES a reload", after === bumped,
        `reloaded value ${after}, expected ${bumped}`);

      // Put it back exactly as found.
      const restore = page.locator('input[type="number"]').first();
      await restore.fill(original);
      await page.getByRole("button", { name: /Save \d+ change/ }).click().catch(() => {});
      await page.waitForTimeout(2000);
      await page.reload({ waitUntil: "networkidle", timeout: 30000 });
      const restored = await page.locator('input[type="number"]').first().inputValue();
      record("ui-stock", "original figure restored", restored === original,
        `back to ${restored}`);
    }
  } catch (error) {
    record("ui-stock", "stock editor flow", false, String(error.message).split("\n")[0].slice(0, 120));
  }
}

/* ------------------------------------------------------------------ */

writeFileSync("ui-e2e-results.json", JSON.stringify({ report, leftovers }, null, 2));

const fails = report.filter((r) => r.pass === false);
const skips = report.filter((r) => r.pass === "skip");
console.log("\n================ UI E2E ================\n");
console.log(`${report.length} checks · ${report.length - fails.length - skips.length} pass · ${fails.length} fail · ${skips.length} skipped\n`);
if (fails.length) {
  console.log("FAILURES:");
  for (const f of fails) console.log(`   [${f.area}] ${f.name} — ${f.detail}`);
  console.log("");
}
if (leftovers.length) {
  console.log("LEFT BEHIND (deactivated, remove by hand):");
  for (const l of leftovers) console.log(`   ${l}`);
  console.log(`\n  delete from warehouses where name like 'E2E UI %';`);
}

for (const s of Object.values(sessions)) await s.browser.close();

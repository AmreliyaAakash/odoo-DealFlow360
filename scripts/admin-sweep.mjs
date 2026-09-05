/**
 * Drives every admin-reachable screen in a real Chrome and reports what broke.
 *
 * Attaches to a Chrome you started yourself with --remote-debugging-port, so it
 * runs inside your existing signed-in session: no credentials are handed to the
 * script, and no cookie store is copied anywhere.
 *
 *   1. Quit Chrome completely (check the tray).
 *   2. Start it with remote debugging on:
 *      "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
 *   3. Sign in to http://localhost:3000 as admin, then:
 *      node scripts/admin-sweep.mjs
 *
 * For each route it records the HTTP status, where it ended up (a redirect to
 * /sign-in or /unauthorized is a finding, not a pass), any Next.js error
 * overlay, any in-page error Notice, the row count of the first table, and
 * every console error and failed request. Screenshots land in the shots dir.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const CDP = process.env.CDP ?? "http://localhost:9222";
const SHOTS = process.argv[2] ?? "admin-sweep-shots";
mkdirSync(SHOTS, { recursive: true });

/** Every screen an admin holds, in the order the sidebar lists them. */
const ROUTES = [
  ["dashboard", "/dashboard"],
  ["admin-desk", "/admin"],
  ["quotations", "/quotations"],
  ["quotations-new", "/quotations/new"],
  ["approvals", "/approvals"],
  ["fulfillment", "/fulfillment"],
  ["subscriptions", "/subscriptions"],
  ["invoices", "/invoices"],
  ["deal-health", "/deal-health"],
  ["reports", "/reports"],
  ["products", "/products"],
  ["upsell-suggestions", "/rep/upsell"],
  // Configuration
  ["discount-setup", "/discount-setup"],
  ["cfg-warehouses", "/backend/warehouses"],
  ["cfg-stock", "/backend/stock"],
  ["cfg-replenishment", "/backend/replenishment"],
  ["cfg-subscriptions", "/backend/subscriptions"],
  ["cfg-upsell-rules", "/backend/upsell-rules"],
  ["cfg-products", "/backend/products"],
  ["cfg-discount-rules", "/backend/discount-rules"],
  ["users-roles", "/admin/users"],
  // Other desks: an admin holds every module, so these must open too.
  ["manager-desk", "/manager"],
  ["manager-pipeline", "/manager/pipeline"],
  ["finance-desk", "/finance"],
  ["finance-billing", "/finance/billing"],
  ["finance-fulfillment", "/finance/fulfillment"],
  ["finance-warehouses", "/finance/warehouses"],
  ["rep-desk", "/rep"],
  ["diagnostics", "/diagnostics"],
];

const browser = await chromium.connectOverCDP(CDP);
const context = browser.contexts()[0];
if (!context) {
  console.error("No browser context. Is Chrome running with --remote-debugging-port=9222?");
  process.exit(1);
}

const page = await context.newPage();
const results = [];

for (const [name, path] of ROUTES) {
  const row = { name, path, consoleErrors: [], failedRequests: [] };

  const onConsole = (msg) => {
    if (msg.type() === "error") row.consoleErrors.push(msg.text().slice(0, 160));
  };
  const onFailed = (req) =>
    row.failedRequests.push(`${req.method()} ${req.url().slice(0, 110)}`);
  const onResponse = (res) => {
    // The page's own data calls, not assets — a 500 here is the real story.
    if (res.status() >= 400 && res.url().includes("/api/")) {
      row.failedRequests.push(`${res.status()} ${res.url().slice(0, 110)}`);
    }
  };

  page.on("console", onConsole);
  page.on("requestfailed", onFailed);
  page.on("response", onResponse);

  try {
    const response = await page.goto(`${BASE}${path}`, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    row.status = response?.status() ?? 0;
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});

    row.landedOn = new URL(page.url()).pathname;
    row.redirected = row.landedOn !== path;

    // Next's dev overlay is the loudest failure and does not always throw.
    // Matched on the error dialog itself, not on <nextjs-portal>: that element
    // hosts the dev-tools indicator and is present on every page in dev, which
    // flags all of them and tells you nothing.
    row.overlay = await page
      .evaluate(() => {
        for (const portal of document.querySelectorAll("nextjs-portal")) {
          const root = portal.shadowRoot;
          if (root?.querySelector("[data-nextjs-dialog], [data-nextjs-error]")) {
            return true;
          }
        }
        return false;
      })
      .catch(() => false);

    const body = await page.locator("body").innerText().catch(() => "");

    // The app's own error surface: <Notice tone="danger"> and the loadError
    // strings the dashboards render instead of throwing.
    const notice = body.match(
      /(Could not (?:load|save|reach)[^\n]{0,120}|column [\w.]+ does not exist[^\n]{0,80}|Could not find the table[^\n]{0,80}|relation "[^"]+" does not exist)/i,
    );
    row.notice = notice ? notice[1].trim() : null;

    row.rows = await page.locator("tbody tr").count().catch(() => 0);
    row.empty = /No .{0,40}(on record|yet|found|match)|Nothing /i.test(body);

    await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
  } catch (error) {
    row.error = String(error.message).split("\n")[0].slice(0, 140);
    await page.screenshot({ path: `${SHOTS}/${name}-ERROR.png` }).catch(() => {});
  }

  page.off("console", onConsole);
  page.off("requestfailed", onFailed);
  page.off("response", onResponse);

  results.push(row);

  const flag = row.error
    ? "THREW"
    : row.overlay
      ? "OVERLAY"
      : row.notice
        ? "NOTICE"
        : row.redirected
          ? `-> ${row.landedOn}`
          : row.status >= 400
            ? `HTTP ${row.status}`
            : "ok";
  console.log(`${flag.padEnd(22)} ${path}  (${row.rows} rows)`);
}

writeFileSync(`${SHOTS}/results.json`, JSON.stringify(results, null, 2));

const broken = results.filter(
  (r) => r.error || r.overlay || r.notice || r.redirected || (r.status ?? 0) >= 400,
);

console.log("\n================ ADMIN SWEEP ================\n");
console.log(`${results.length} routes, ${broken.length} with findings\n`);

for (const r of broken) {
  console.log(`${r.path}`);
  if (r.error) console.log(`   threw    : ${r.error}`);
  if (r.status >= 400) console.log(`   status   : ${r.status}`);
  if (r.redirected) console.log(`   landed   : ${r.landedOn}  (expected ${r.path})`);
  if (r.overlay) console.log(`   overlay  : Next.js error overlay present`);
  if (r.notice) console.log(`   notice   : ${r.notice}`);
  if (r.consoleErrors.length) {
    console.log(`   console  : ${r.consoleErrors.slice(0, 3).join(" | ")}`);
  }
  if (r.failedRequests.length) {
    console.log(`   requests : ${r.failedRequests.slice(0, 3).join(" | ")}`);
  }
  console.log("");
}

const emptyTables = results.filter((r) => !r.error && r.rows === 0 && !r.redirected);
if (emptyTables.length) {
  console.log("Rendered but no table rows (may be genuinely empty, worth a look):");
  for (const r of emptyTables) console.log(`   ${r.path}`);
  console.log("");
}

console.log(`Screenshots: ${SHOTS}/`);
await page.close();
await browser.close();

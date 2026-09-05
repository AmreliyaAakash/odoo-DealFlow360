/**
 * Drives the real Chrome browser through every role.
 *
 * For each account: sign in with email + password, record where it landed and
 * what role the sidebar shows, then try one URL that role must not reach and
 * record what happened. Screenshots at each step.
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const accounts = JSON.parse(readFileSync(process.argv[2], "utf8"));
const SHOTS = process.argv[3];
mkdirSync(SHOTS, { recursive: true });

const BASE = "http://localhost:3000";

/** A route each role must be refused, to prove URL access is gated. */
const FORBIDDEN = {
  admin: null, // admin may reach everything
  manager: "/admin",
  finance: "/manager",
  rep: "/finance",
  customer: "/rep",
};

const results = [];

const browser = await chromium.launch({ channel: "chrome", headless: false, slowMo: 60 });

for (const account of accounts) {
  // A fresh context per role = a clean cookie jar, so sessions never collide.
  const context = await browser.newContext({ viewport: { width: 1380, height: 900 } });
  const page = await context.newPage();
  const row = { role: account.role, email: account.email };

  try {
    await page.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded", timeout: 45000 });

    // Clerk renders its form inside the page; wait for the identifier field.
    await page.waitForSelector('input[name="identifier"]', { timeout: 40000 });
    await page.fill('input[name="identifier"]', account.email);
    await page.getByRole("button", { name: /continue/i }).first().click();

    await page.waitForSelector('input[name="password"]', { timeout: 40000 });
    await page.fill('input[name="password"]', account.password);
    await page.getByRole("button", { name: /continue/i }).first().click();

    // Let the redirect chain settle on whatever the role lands on.
    await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), {
      timeout: 45000,
    });
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});

    row.landedOn = new URL(page.url()).pathname;
    await page.screenshot({ path: `${SHOTS}/${account.role}-1-landing.png`, fullPage: false });

    // What role does the UI claim?
    const body = await page.locator("body").innerText().catch(() => "");
    const label = body.match(
      /\b(Admin|Sales Manager|Finance|Sales Rep|Customer|No role)\b/,
    );
    row.roleShown = label ? label[1] : "(not found)";

    // Which nav items are offered?
    const links = await page.locator("aside a").allInnerTexts().catch(() => []);
    row.nav = links.map((l) => l.trim().split("\n")[0]).filter(Boolean).join(" · ");

    // Direct-URL access to something this role must not have.
    const blocked = FORBIDDEN[account.role];
    if (blocked) {
      await page.goto(`${BASE}${blocked}`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
      const after = new URL(page.url()).pathname;
      row.triedUrl = blocked;
      row.urlResult = after === blocked ? "REACHED (leak)" : `blocked -> ${after}`;
      await page.screenshot({ path: `${SHOTS}/${account.role}-2-forbidden.png` });
    } else {
      row.triedUrl = "-";
      row.urlResult = "n/a (admin)";
    }
  } catch (error) {
    row.error = String(error.message).split("\n")[0].slice(0, 110);
    await page
      .screenshot({ path: `${SHOTS}/${account.role}-ERROR.png` })
      .catch(() => {});
  }

  results.push(row);
  await context.close();
}

await browser.close();

console.log("\n================ ROLE TEST RESULTS ================\n");
for (const r of results) {
  console.log(`${r.role.toUpperCase()}  ${r.email}`);
  if (r.error) {
    console.log(`   FAILED: ${r.error}`);
  } else {
    console.log(`   landed on   : ${r.landedOn}`);
    console.log(`   role shown  : ${r.roleShown}`);
    console.log(`   sidebar     : ${r.nav || "(none)"}`);
    console.log(`   tried ${String(r.triedUrl).padEnd(9)}: ${r.urlResult}`);
  }
  console.log("");
}

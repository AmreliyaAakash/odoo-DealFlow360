/**
 * Proves the realtime pipeline end to end, rather than assuming it.
 *
 * The admin desk's audit feed subscribes to INSERT on `config_audit_log`
 * (app/(dashboard)/admin/audit-log.tsx) and every write through
 * /api/backend/[entity] records a row there. So: park a watcher on /admin,
 * perform a config write from a SECOND tab, and require the new row to appear
 * in the watcher's DOM with no navigation and no reload.
 *
 * A passing run means Supabase realtime is connected, RLS lets the row through
 * to this account, the channel is subscribed, and React committed the update —
 * the whole chain, not just "the socket opened".
 *
 *   node scripts/realtime-e2e.mjs
 */
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const TAG = `E2E-RT-${Date.now()}`;

const browser = await chromium.connectOverCDP("http://localhost:9222");
const ctx = browser.contexts()[0];

const watcher = ctx.pages()[0] ?? (await ctx.newPage());
const writer = await ctx.newPage();

let created = null;

try {
  await watcher.goto(`${BASE}/admin`, { waitUntil: "networkidle", timeout: 30000 });

  // The feed marks itself live only once .subscribe() reports SUBSCRIBED, so
  // waiting on that is waiting on a real open channel rather than a timer.
  const liveBadge = watcher.locator("text=/live/i").first();
  const wentLive = await liveBadge
    .waitFor({ state: "visible", timeout: 15000 })
    .then(() => true)
    .catch(() => false);

  const before = await watcher.locator("tbody tr").count();
  console.log(`watcher on /admin — live indicator: ${wentLive ? "yes" : "not found"}`);
  console.log(`audit rows before: ${before}`);

  // A config write from another tab. Same account, different page: the watcher
  // must learn about it over the socket, not from its own request.
  await writer.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 25000 });

  const res = await writer.evaluate(async (name) => {
    const list = await fetch("/api/backend/warehouses").then((r) => r.json());
    const template = { ...(list.rows ?? [])[0] };
    delete template.id;
    template.name = name;
    template.code = `RT${String(Date.now()).slice(-5)}`;
    const post = await fetch("/api/backend/warehouses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(template),
    });
    return { status: post.status, body: await post.json().catch(() => null) };
  }, TAG);

  console.log(`write from second tab: POST /api/backend/warehouses -> ${res.status}`);

  if (res.status !== 200 && res.status !== 201) {
    console.log(`FAIL — write rejected: ${JSON.stringify(res.body).slice(0, 200)}`);
    process.exitCode = 1;
  } else {
    // Wait for the DOM to grow on its own. No reload, no navigation.
    const grew = await watcher
      .waitForFunction(
        (n) => document.querySelectorAll("tbody tr").length > n,
        before,
        { timeout: 15000 },
      )
      .then(() => true)
      .catch(() => false);

    const after = await watcher.locator("tbody tr").count();
    const sawTag = await watcher
      .locator(`text=${TAG}`)
      .count()
      .then((n) => n > 0)
      .catch(() => false);
    const url = watcher.url();

    console.log(`audit rows after : ${after}`);
    console.log(`watcher url unchanged: ${url.endsWith("/admin")}`);
    console.log(`new row visible without reload: ${grew}`);
    console.log(`row carries the tag: ${sawTag}`);

    console.log(
      `\n${grew ? "PASS" : "FAIL"} — realtime ${grew ? "delivered" : "did NOT deliver"} the insert to an open page`,
    );
    if (!grew) process.exitCode = 1;

    // Find what we made so it can be reported and deactivated.
    const found = await writer.evaluate(async (name) => {
      const list = await fetch("/api/backend/warehouses").then((r) => r.json());
      return (list.rows ?? []).find((r) => r.name === name)?.id ?? null;
    }, TAG);
    created = found;
  }
} catch (error) {
  console.log(`ERROR — ${String(error.message).split("\n")[0].slice(0, 160)}`);
  process.exitCode = 1;
} finally {
  if (created) {
    await writer
      .evaluate(
        async (id) =>
          fetch(`/api/backend/warehouses?id=${id}`, { method: "DELETE" }).then((r) => r.status),
        created,
      )
      .then((s) => console.log(`\ncleanup: deactivated ${created} (${s})`))
      .catch(() => console.log(`\ncleanup FAILED for ${created} — remove by hand`));
  }
  await writer.close();
  await browser.close();
}

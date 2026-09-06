/**
 * The money paths: warehouse allocation and billing arithmetic.
 *
 * Read-only by design. Every figure is recomputed here from the source rows
 * and diffed against what the server stored — no payment is recorded and no
 * allocation is committed, because both write to books that belong to the
 * business rather than to a test. Validation edges are probed with values the
 * handler must reject, so those write nothing either.
 *
 *   node scripts/money-qa.mjs
 */
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const results = [];

function check(area, name, pass, detail = "") {
  results.push({ area, name, pass, detail });
  const m = pass === true ? "PASS" : pass === "skip" ? "SKIP" : "FAIL";
  console.log(`  ${m.padEnd(4)} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function api(page, method, path, body) {
  return page.evaluate(
    async ([m, u, b]) => {
      const r = await fetch(u, {
        method: m,
        headers: b ? { "Content-Type": "application/json" } : undefined,
        body: b ? JSON.stringify(b) : undefined,
      });
      let j = null;
      try { j = JSON.parse(await r.text()); } catch {}
      return { status: r.status, body: j };
    },
    [method, path, body ?? null],
  );
}

const r2 = (n) => Math.round(n * 100) / 100;

const S = {};
for (const port of [9222, 9223]) {
  try {
    const br = await chromium.connectOverCDP(`http://localhost:${port}`);
    const pg = br.contexts()[0].pages()[0] ?? (await br.contexts()[0].newPage());
    await pg.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await pg.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    const role = await pg.evaluate(() => {
      const a = document.querySelector("aside");
      const b = a?.querySelector(".ring-1.ring-border");
      const t = b ? b.innerText.trim().split("\n").pop() : "";
      return { Admin: "admin", Finance: "finance" }[t] ?? "unknown";
    });
    S[role] = { br, pg };
  } catch {}
}
const A = S.admin ?? Object.values(S)[0];
console.log("sessions:", Object.keys(S).join(", "));

/* ================= warehouse split ================= */

console.log("\n=== warehouse split ===");

if (A) {
  const list = await api(A.pg, "GET", "/api/quotations");
  const quotes = list.body?.quotations ?? [];
  let tested = 0;

  for (const q of quotes.filter((x) => ["approved", "won"].includes(x.status)).slice(0, 3)) {
    // What the order actually asks for, from the quotation itself.
    const full = await api(A.pg, "GET", `/api/quotations/${q.id}`);
    const body = full.body?.quotation ?? full.body;
    const lines = body?.quotation_lines ?? body?.lines ?? [];
    if (!lines.length) continue;

    const asked = new Map();
    for (const l of lines) {
      const pid = l.product_id ?? l.productId ?? l.products?.id;
      if (pid) asked.set(pid, (asked.get(pid) ?? 0) + Number(l.qty ?? 0));
    }

    const split = await api(A.pg, "POST", "/api/warehouse-split", { quotationId: q.id, save: false });
    if (split.status !== 200) {
      check("split", `${q.reference ?? q.id.slice(0, 8)} preview`, false, `status ${split.status}`);
      continue;
    }
    tested += 1;
    const s = split.body;
    const all = [...(s.allocations ?? []), ...(s.committed ?? [])];

    console.log(`  ${q.reference ?? q.id.slice(0, 8)}: ${asked.size} product(s) asked, ${all.length} allocation(s), ${(s.shortfalls ?? []).length} shortfall(s), fullyAllocated=${s.fullyAllocated}`);

    check("split", "every allocation quantity is positive",
      all.every((a) => Number(a.qty) > 0),
      `${all.length} allocations`);

    const got = new Map();
    for (const a of all) got.set(a.productId, (got.get(a.productId) ?? 0) + Number(a.qty));

    const over = [];
    for (const [pid, want] of asked) {
      const have = got.get(pid) ?? 0;
      if (r2(have) > r2(want)) over.push(`${pid.slice(0, 8)} allocated ${have} > asked ${want}`);
    }
    check("split", "allocated never exceeds ordered quantity", over.length === 0,
      over.length ? over.join("; ") : [...asked].map(([p, w]) => `${got.get(p) ?? 0}/${w}`).join("  "));

    // shortfall must equal the unmet remainder, not be invented or hidden
    const shortMap = new Map();
    for (const sf of s.shortfalls ?? []) shortMap.set(sf.productId, Number(sf.qty ?? sf.short ?? 0));
    const bad = [];
    for (const [pid, want] of asked) {
      const have = got.get(pid) ?? 0;
      const expectedShort = r2(Math.max(0, want - have));
      const reported = r2(shortMap.get(pid) ?? 0);
      if (expectedShort !== reported) bad.push(`${pid.slice(0, 8)} short ${expectedShort} but reported ${reported}`);
    }
    check("split", "shortfall equals ordered minus allocated", bad.length === 0,
      bad.length ? bad.join("; ") : "no discrepancy");

    check("split", "fullyAllocated agrees with the shortfall list",
      Boolean(s.fullyAllocated) === ((s.shortfalls ?? []).length === 0),
      `fullyAllocated=${s.fullyAllocated}, shortfalls=${(s.shortfalls ?? []).length}`);

    // no warehouse is asked for more than it holds
    const stock = s.warehouses ?? [];
    const oversold = [];
    for (const a of s.allocations ?? []) {
      const w = stock.find((x) => x.id === a.warehouseId || x.warehouseId === a.warehouseId);
      const avail = w ? Number(w.available ?? w.qty ?? NaN) : NaN;
      if (Number.isFinite(avail) && Number(a.qty) > avail) {
        oversold.push(`${a.warehouseName} ${a.qty} > ${avail}`);
      }
    }
    check("split", "no allocation exceeds that warehouse's stock", oversold.length === 0,
      oversold.length ? oversold.join("; ") : "within available stock");
  }
  if (!tested) check("split", "allocation checks", "skip", "no approved/won quotation with lines");
}

/* ================= billing ================= */

console.log("\n=== billing ===");

if (A) {
  const ids = await A.pg.evaluate(async () => {
    const html = await (await fetch("/invoices")).text();
    return [...new Set((html.match(/\/invoices\/([0-9a-f-]{36})/g) || []).map((s) => s.split("/").pop()))];
  });
  console.log(`  ${ids.length} invoice(s) found`);

  let withPayments = 0;
  for (const id of ids.slice(0, 6)) {
    const r = await api(A.pg, "GET", `/api/invoices/${id}`);
    if (r.status !== 200) { check("billing", `invoice ${id.slice(0, 8)}`, false, `status ${r.status}`); continue; }
    const inv = r.body?.invoice ?? r.body;
    const lines = inv.invoice_lines ?? [];
    const pays = inv.payments ?? [];

    const lineSum = lines.reduce((t, l) => t + Number(l.amount ?? 0), 0);
    check("billing", `${inv.reference}: total = sum(line amounts)`,
      r2(lineSum) === r2(Number(inv.total)),
      `${r2(lineSum)} vs ${inv.total}`);

    const paidSum = pays.reduce((t, p) => t + Number(p.amount ?? 0), 0);
    check("billing", `${inv.reference}: amount_paid = sum(payments)`,
      r2(paidSum) === r2(Number(inv.amount_paid ?? 0)),
      `${r2(paidSum)} vs ${inv.amount_paid} (${pays.length} payment(s))`);

    const outstanding = r2(Number(inv.total) - Number(inv.amount_paid ?? 0));
    check("billing", `${inv.reference}: outstanding is not negative`,
      outstanding >= 0, `${inv.total} - ${inv.amount_paid} = ${outstanding}`);

    if (pays.length) withPayments += 1;
  }
  if (!withPayments) {
    check("billing", "payment application against a paid invoice", "skip",
      "no invoice in this dataset carries a payment — partial/overpayment behaviour cannot be observed read-only");
  }

  // Validation edges. All must be refused, so none of these write anything.
  const probe = ids[0];
  if (probe) {
    for (const [label, body, want] of [
      ["zero payment refused", { amount: 0 }, 400],
      ["negative payment refused", { amount: -100 }, 400],
      ["non-numeric payment refused", { amount: "abc" }, 400],
      ["negative quantity change refused", { action: "change_quantity", qty: -1 }, 400],
    ]) {
      const r = await api(A.pg, "POST", `/api/invoices/${probe}`, body);
      check("billing", label, r.status === want, `status ${r.status} ${r.body?.error ?? ""}`);
    }
  }
}

/* ================= summary ================= */

const fails = results.filter((r) => r.pass === false);
const skips = results.filter((r) => r.pass === "skip");
console.log(`\n${results.length} checks · ${results.length - fails.length - skips.length} pass · ${fails.length} fail · ${skips.length} skipped`);
if (fails.length) {
  console.log("\nFAILURES:");
  for (const f of fails) console.log(`   [${f.area}] ${f.name} — ${f.detail}`);
}
console.log("\nNo payments recorded, no allocations committed — this run wrote nothing.");

for (const s of Object.values(S)) await s.br.close();

/**
 * Business-logic verification: discount ceilings, approval routing, and the
 * arithmetic behind a quotation.
 *
 * Expected values are computed here from the configured rules, then diffed
 * against what the server returns — the point is to disagree with the product,
 * not to echo it. Every quotation this creates is referenced E2E-LOGIC-* and
 * listed at the end so it can be removed.
 *
 *   node scripts/logic-qa.mjs
 */
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const TAG = `E2E-LOGIC-${String(Date.now()).slice(-6)}`;
const created = [];
const results = [];

function check(area, name, pass, detail = "") {
  results.push({ area, name, pass, detail });
  console.log(`  ${pass === true ? "PASS " : pass === "skip" ? "SKIP " : "FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
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

const S = {};
for (const port of [9222, 9223, 9224, 9225, 9226]) {
  try {
    const br = await chromium.connectOverCDP(`http://localhost:${port}`);
    const pg = br.contexts()[0].pages()[0] ?? (await br.contexts()[0].newPage());
    await pg.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 25000 });
    await pg.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    const role = await pg.evaluate(() => {
      const a = document.querySelector("aside");
      if (!a) return "customer";
      const b = a.querySelector(".ring-1.ring-border");
      const t = b ? b.innerText.trim().split("\n").pop() : "";
      return { Admin: "admin", "Sales Manager": "manager", Finance: "finance", "Sales Rep": "rep", Customer: "customer" }[t] ?? "unknown";
    });
    S[role] = { br, pg };
  } catch {}
}
console.log("sessions:", Object.keys(S).join(", "));

/* ---------------- override isolation ---------------- */

console.log("\n=== per-account override isolation ===");
if (S.admin) {
  const r = await S.admin.pg.evaluate(async () => {
    const ids = [...new Set(document.body.innerHTML.match(/user_[A-Za-z0-9]+/g) || [])];
    const out = {};
    for (const id of ids) {
      const res = await fetch(`/api/admin/users/${id}/permissions`);
      if (!res.ok) continue;
      const j = await res.json();
      out[j.role] = {
        baseline: j.baseline.discountRules?.capability,
        effective: j.effective.discountRules?.capability,
        overrides: (j.overrides || []).length,
      };
    }
    return out;
  });
  await S.admin.pg.goto(`${BASE}/admin/users`, { waitUntil: "networkidle", timeout: 30000 });
  const r2 = await S.admin.pg.evaluate(async () => {
    const ids = [...new Set(document.body.innerHTML.match(/user_[A-Za-z0-9]+/g) || [])];
    const out = {};
    for (const id of ids) {
      const res = await fetch(`/api/admin/users/${id}/permissions`);
      if (!res.ok) continue;
      const j = await res.json();
      out[j.role] = {
        baseline: j.baseline.discountRules?.capability,
        effective: j.effective.discountRules?.capability,
        overrides: (j.overrides || []).length,
      };
    }
    return out;
  });
  const table = Object.keys(r2).length ? r2 : r;
  for (const [role, v] of Object.entries(table)) {
    console.log(`  ${role.padEnd(9)} discountRules baseline=${v.baseline} effective=${v.effective} overrides=${v.overrides}`);
  }
  const fin = table.finance, mgr = table.manager;
  check("overrides", "finance override does not leak to manager",
    Boolean(fin && mgr && fin.effective === "none" && mgr.effective === mgr.baseline),
    fin && mgr ? `finance ${fin.baseline}->${fin.effective}, manager ${mgr.baseline}->${mgr.effective}` : "roles missing");
}

/* ---------------- discount ceiling boundary ---------------- */

console.log("\n=== discount ceiling: at the ceiling vs one point past ===");

if (S.admin && S.rep) {
  const rules = await api(S.admin.pg, "GET", "/api/backend/discount-rules");
  const active = (rules.body?.rows ?? []).filter((r) => r.active);
  console.log(`  ${active.length} active discount rules configured`);

  // The lowest active ceiling that applies to everything (no tier/category scope)
  const global = active
    .filter((r) => r.scope === "global" || !r.scope_ref)
    .sort((a, b) => Number(a.max_discount_pct) - Number(b.max_discount_pct))[0];

  if (!global) {
    check("ceiling", "boundary behaviour", "skip", "no unscoped rule to test against");
  } else {
    const ceiling = Number(global.max_discount_pct);
    console.log(`  testing against "${global.name}" ceiling=${ceiling}% level=${global.approval_level}`);

    const cat = await api(S.rep.pg, "GET", "/api/backend/products");
    const product = (cat.body?.rows ?? []).find((p) => p.active);
    const qs = await api(S.rep.pg, "GET", "/api/quotations");
    const first = (qs.body?.quotations ?? qs.body?.rows ?? [])[0];
      const customerId = first?.customers?.id ?? first?.customer_id ?? null;

    if (!product || !customerId) {
      check("ceiling", "boundary behaviour", "skip", "no product/customer to build a quotation from");
    } else {
      for (const [label, pct, shouldEscalate] of [
        ["exactly at the ceiling", ceiling, false],
        ["one point past the ceiling", ceiling + 1, true],
      ]) {
        const res = await api(S.rep.pg, "POST", "/api/quotations", {
          customerId,
          reference: `${TAG}-${pct}`,
          lines: [{ productId: product.id, qty: 1, discountPct: pct }],
        });
        const q = res.body?.quotation ?? res.body;
        if (!q?.id) {
          check("ceiling", `${label} (${pct}%)`, false, `create failed ${res.status} ${res.body?.error ?? ""}`);
          continue;
        }
        created.push({ id: q.id, ref: `${TAG}-${pct}` });

        const read = await api(S.rep.pg, "GET", `/api/quotations/${q.id}`);
        const full = read.body?.quotation ?? read.body;
        const required = full?.required_approvals ?? [];
        const escalated = required.length > 0;

        check("ceiling", `${label} (${pct}%) ${shouldEscalate ? "requires" : "does not require"} approval`,
          escalated === shouldEscalate,
          `required_approvals = [${required.join(", ")}]`);
      }
    }
  }
}

/* ---------------- quotation arithmetic ---------------- */

console.log("\n=== quotation arithmetic (server prices, we recompute) ===");

if (S.rep && created.length) {
  const target = created[created.length - 1];
  const read = await api(S.rep.pg, "GET", `/api/quotations/${target.id}`);
  const q = read.body?.quotation ?? read.body;
  const lines = q?.quotation_lines ?? q?.lines ?? [];

  if (!lines.length) {
    check("math", "line totals", "skip", "no lines returned on the quotation");
  } else {
    let sub = 0, net = 0;
    for (const l of lines) {
      const unit = Number(l.unit_price ?? 0);
      const qty = Number(l.qty ?? 0);
      const disc = Number(l.discount_pct ?? 0);
      sub += unit * qty;
      net += unit * qty * (1 - disc / 100);
    }
    const round2 = (n) => Math.round(n * 100) / 100;
    check("math", "subtotal = sum(unit x qty)",
      round2(sub) === round2(Number(q.subtotal ?? -1)),
      `computed ${round2(sub)} vs stored ${q.subtotal}`);
    check("math", "net = subtotal less line discounts",
      round2(net) === round2(Number(q.net_total ?? -1)),
      `computed ${round2(net)} vs stored ${q.net_total}`);
    check("math", "discount_total = subtotal - net",
      round2(sub - net) === round2(Number(q.discount_total ?? -1)),
      `computed ${round2(sub - net)} vs stored ${q.discount_total}`);
  }
}

/* ---------------- approval gate: cannot advance unsigned ---------------- */

console.log("\n=== approval routing ===");

if (S.rep && S.manager && created.length) {
  const target = created[created.length - 1];
  const sub = await api(S.rep.pg, "PATCH", `/api/quotations/${target.id}`, { status: "pending_approval" });
  const read = await api(S.manager.pg, "GET", `/api/quotations/${target.id}`);
  const q = read.body?.quotation ?? read.body;
  const required = q?.required_approvals ?? [];

  check("approval", "submitted quotation is visible to the approver",
    read.status === 200, `status ${read.status}, quotation status ${q?.status}`);

  if (required.includes("finance") && !required.includes("manager")) {
    const wrong = await api(S.manager.pg, "POST", `/api/quotations/${target.id}/approve`, { action: "approve", level: 2 });
    check("approval", "manager refused at a finance-only tier", wrong.status === 403,
      `status ${wrong.status} ${wrong.body?.error ?? ""}`);
  } else if (required.length) {
    const wrongTier = await api(S.manager.pg, "POST", `/api/quotations/${target.id}/approve`, { action: "approve", level: 2 });
    check("approval", "manager cannot act at level 2 (finance tier)", wrongTier.status === 403,
      `status ${wrongTier.status} ${wrongTier.body?.error ?? ""}`);
  } else {
    check("approval", "tier enforcement", "skip", "this quotation required no approvals");
  }

  const repTry = await api(S.rep.pg, "POST", `/api/quotations/${target.id}/approve`, { action: "approve", level: 1 });
  check("approval", "rep cannot approve their own deal", repTry.status === 403,
    `status ${repTry.status}`);
}

/* ---------------- summary ---------------- */

const fails = results.filter((r) => r.pass === false);
const skips = results.filter((r) => r.pass === "skip");
console.log(`\n${results.length} checks · ${results.length - fails.length - skips.length} pass · ${fails.length} fail · ${skips.length} skipped`);
if (created.length) {
  console.log("\nQuotations created by this run:");
  for (const c of created) console.log(`   ${c.ref}  ${c.id}`);
  console.log(`\n  delete from quotations where reference like '${TAG}%';`);
}

for (const s of Object.values(S)) await s.br.close();

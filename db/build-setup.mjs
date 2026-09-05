/**
 * Regenerates db/setup.sql by concatenating the source files.
 *
 * setup.sql is GENERATED — never edit it by hand. Edit schema.sql, seed.sql or
 * demo.sql and run `npm run db:build`.
 *
 * The role permission defaults are not written by hand either: they are emitted
 * from lib/permissions.ts, so the matrix the app enforces and the rows RLS reads
 * are the same rules. Editing one without the other is the bug this prevents.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(here, name), "utf8").trimEnd();

const { PERMISSIONS, MODULES, ROLES } = await import(
  pathToFileURL(join(here, "..", "lib", "permissions.ts")).href
);

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** The static matrix, as the seed rows for `role_module_permissions`. */
function rolePermissionSeed() {
  const rows = [];

  for (const role of ROLES) {
    for (const module of MODULES) {
      const access = PERMISSIONS[module][role];
      rows.push(
        `  (${sqlString(role)}, ${sqlString(module)}, ` +
          `${sqlString(access.capability)}, ${sqlString(access.scope)})`,
      );
    }
  }

  return `-- ============================================================ role defaults
--
-- GENERATED from lib/permissions.ts by db/build-setup.mjs. These are the
-- defaults a role starts with; an admin may edit them afterwards from Settings,
-- and re-running this file resets them to the matrix in code.
--
-- \`on conflict do update\` rather than \`do nothing\`: a rebuild is how you push
-- a matrix change out to an existing database.

insert into role_module_permissions (role, module, capability, scope) values
${rows.join(",\n")}
on conflict (role, module) do update
  set capability = excluded.capability,
      scope      = excluded.scope,
      updated_at = now();`;
}

const header = `-- ============================================================================
-- DealFlow360 — complete setup. Paste into Supabase → SQL Editor → Run.
-- Idempotent: every statement is guarded, so re-running is safe.
--
-- GENERATED FILE — do not edit. Source: schema.sql + seed.sql + demo.sql
-- Rebuild with: npm run db:build
-- ============================================================================
`;

const out = [
  header,
  read("schema.sql"),
  rolePermissionSeed(),
  read("seed.sql"),
  read("demo.sql"),
].join("\n\n");

writeFileSync(join(here, "setup.sql"), out + "\n");
console.log(`db/setup.sql rebuilt (${out.split("\n").length} lines)`);

/**
 * The same thing minus the sample rows, for a database that already has real
 * data in it and is only missing structure.
 *
 * The role defaults are not optional here, which is the whole reason this is a
 * separate file rather than "just run schema.sql". `effective_capability()`
 * reads `role_module_permissions` and falls back to 'none', not to the static
 * matrix in lib/permissions.ts — that fallback is app-side only. Creating the
 * table empty therefore denies every non-admin every module, which looks
 * exactly like the missing-data bug you ran this to fix.
 */
const repairHeader = `-- ============================================================================
-- DealFlow360 — structure repair. Paste into Supabase → SQL Editor → Run.
--
-- For a database that predates part of schema.sql: creates whatever tables,
-- columns, functions and policies are missing and seeds the role permission
-- defaults, WITHOUT inserting the sample catalogue or the demo quotations.
-- Your own rows are left alone.
--
-- Idempotent: every statement is guarded, so re-running is safe. The one thing
-- to know before running is that schema.sql drops duplicate \`name\` rows in
-- discount_rules, subscription_plans, customers and upsell_rules (keeping the
-- oldest) so it can put unique indexes on that column.
--
-- GENERATED FILE — do not edit. Source: schema.sql
-- Rebuild with: npm run db:build
-- ============================================================================
`;

const repair = [repairHeader, read("schema.sql"), rolePermissionSeed()].join("\n\n");

writeFileSync(join(here, "repair.sql"), repair + "\n");
console.log(`db/repair.sql rebuilt (${repair.split("\n").length} lines)`);

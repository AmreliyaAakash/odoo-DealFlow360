/**
 * Regenerates db/setup.sql by concatenating the source files.
 *
 * setup.sql is GENERATED — never edit it by hand. Edit schema.sql, seed.sql or
 * demo.sql and run `npm run db:build`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(here, name), "utf8").trimEnd();

const header = `-- ============================================================================
-- DealFlow360 — complete setup. Paste into Supabase → SQL Editor → Run.
-- Idempotent: every statement is guarded, so re-running is safe.
--
-- GENERATED FILE — do not edit. Source: schema.sql + seed.sql + demo.sql
-- Rebuild with: npm run db:build
-- ============================================================================
`;

const out = [header, read("schema.sql"), read("seed.sql"), read("demo.sql")].join(
  "\n\n",
);

writeFileSync(join(here, "setup.sql"), out + "\n");
console.log(`db/setup.sql rebuilt (${out.split("\n").length} lines)`);

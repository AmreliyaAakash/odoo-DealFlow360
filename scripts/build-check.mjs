/**
 * Type-checks and builds into a throwaway dist directory, so it is safe to run
 * while `next dev` is serving from `.next`.
 */
import { spawnSync } from "node:child_process";

const result = spawnSync("npx", ["next", "build"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, NEXT_DIST_DIR: ".next-build" },
});

process.exit(result.status ?? 1);

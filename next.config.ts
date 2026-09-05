import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * `next build` and `next dev` both write to `.next`. Running a build while the
   * dev server is up corrupts its route manifest, which shows up as spurious
   * 404s on routes that plainly exist. `npm run build:check` sets
   * NEXT_DIST_DIR so a verification build uses its own directory instead.
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;

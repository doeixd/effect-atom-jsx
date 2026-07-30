import { defineConfig } from "vitest/config";

/**
 * The `future/` specification suite. Separate from `vitest.config.ts` on
 * purpose: these specs describe the finished design, so the suite is expected
 * to be partially red and must never gate `npm test`.
 *
 * Run with `npm run test:future`.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["future/**/*.spec.ts"],
    // Same isolation rule as the main suite: global reactive state must not
    // bleed between specs.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    // A red spec is a work item, not an emergency. Keep the whole worklist
    // visible in one run instead of stopping at the first failure.
    bail: 0,
  },
});

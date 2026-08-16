import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

export default defineConfig({
  resolve: {
    // Workspace adapter packages import the PUBLIC core subpaths. Under test
    // those resolve to `src/` (one module identity with the suite — the
    // `Symbol.for` registry would tolerate dist, but a stale `dist/` must
    // never decide a test), and `@affe/agent` resolves to its source.
    alias: {
      "effect-atom-jsx/Agent": here("./src/Agent.ts"),
      "@affe/agent": here("./packages/agent/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/__tests__/**/*.test.ts"],
    // Run tests serially so global reactive state doesn't bleed between tests.
    pool: "forks",
    singleFork: true,
  },
});

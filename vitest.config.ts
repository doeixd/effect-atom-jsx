import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/__tests__/**/*.test.ts"],
    // Run tests serially so global reactive state doesn't bleed between tests.
    pool: "forks",
    singleFork: true,
  },
});

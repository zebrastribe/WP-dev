import { defineConfig } from "vitest/config";

/** Smoke tests — run after `npm run build` (uses dist/cli.js). */
export default defineConfig({
  test: {
    environment: "node",
    pool: "forks",
    include: ["tests/smoke/**/*.test.ts"],
    testTimeout: 30_000,
  },
});

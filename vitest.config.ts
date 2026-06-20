import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    pool: "forks",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/smoke/**/*.test.ts"],
    coverage: {
      provider: "v8",
      /** Measure testable layers; CLI command orchestration is covered by smoke/integration manually. */
      include: [
        "src/services/**/*.ts",
        "src/utils/**/*.ts",
        "src/config/**/*.ts",
        "src/commands/fix-permissions.ts",
      ],
      exclude: ["src/cli.ts"],
      thresholds: {
        lines: 39,
        functions: 53,
        branches: 68,
        statements: 39,
        "src/services/sync-excludes.ts": {
          lines: 75,
          functions: 75,
          branches: 65,
          statements: 75,
        },
        "src/services/sync-units.ts": {
          lines: 90,
          functions: 90,
          branches: 68,
          statements: 90,
        },
        "src/services/sync-preview-parse.ts": {
          lines: 84,
          functions: 80,
          branches: 75,
          statements: 84,
        },
      },
      reporter: ["text", "text-summary", "lcov"],
    },
  },
});

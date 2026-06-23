import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    pool: "forks",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/smoke/**/*.test.ts"],
    coverage: {
      provider: "v8",
      /** Measure testable layers; CLI/orchestration covered by smoke/integration. */
      include: [
        "src/services/**/*.ts",
        "src/utils/**/*.ts",
        "src/config/**/*.ts",
        "src/fs/atomic-write.ts",
        "src/fs/path-resolver.ts",
        "src/fs/temp-registry.ts",
        "src/fs/update-lock.ts",
        "src/fs/ownership/profiles.ts",
        "src/fs/recovery.ts",
        "src/supervisor/project-lock.ts",
        "src/supervisor/service-registry.ts",
        "src/supervisor/port-manager.ts",
        "src/supervisor/paths.ts",
        "src/commands/fix-permissions.ts",
      ],
      exclude: [
        "src/cli.ts",
        "src/supervisor/daemon.ts",
        "src/supervisor/startup.ts",
        "src/supervisor/shutdown.ts",
        "src/supervisor/client.ts",
        "src/supervisor/process-manager.ts",
        "src/supervisor/port-probe.ts",
        "src/fs/ownership/reconcile.ts",
      ],
      thresholds: {
        lines: 50,
        functions: 55,
        branches: 68,
        statements: 50,
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

import { describe, expect, it, vi } from "vitest";
import {
  UPDATE_WORDPRESS_SAFETY,
  buildUpdateSteps,
  cmdUpdate,
} from "../src/commands/update.js";
import { minimalWpDevConfig } from "./helpers/fixtures.js";
import type { LoadedConfig } from "../src/config/load.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("wp-dev update", () => {
  it("documents wordpress safety", () => {
    expect(UPDATE_WORDPRESS_SAFETY).toMatch(/wordpress/i);
    expect(UPDATE_WORDPRESS_SAFETY).toMatch(/not replaced/i);
  });

  it("buildUpdateSteps includes git pull and build by default", () => {
    const steps = buildUpdateSteps({});
    const shells = steps.map((s) => s.shell).join("\n");
    expect(shells).toContain("git");
    expect(shells).toContain("npm install");
    expect(shells).toContain("npm run build");
    expect(shells).toContain("build:wp");
    expect(shells).toContain("wp-dev -- down");
  });

  it("buildUpdateSteps respects no-admin and no-restart", () => {
    const steps = buildUpdateSteps({ noAdmin: true, noRestart: true, skipPull: true });
    const shells = steps.map((s) => s.shell).join("\n");
    expect(shells).not.toContain("git");
    expect(shells).not.toContain("build:wp");
    expect(shells).not.toContain("wp-dev -- down");
  });

  it("cmdUpdate dry-run prints planned steps", async () => {
    const configDir = mkdtempSync(join(tmpdir(), "wp-dev-update-"));
    const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const loaded = {
        configDir,
        config: minimalWpDevConfig(),
      } as LoadedConfig;
      await cmdUpdate(loaded, { dryRun: true });
      const out = stderrSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(out).toContain("Dry run");
      expect(out).toContain("git");
      expect(out).toContain(UPDATE_WORDPRESS_SAFETY);
    } finally {
      stderrSpy.mockRestore();
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it("cmdUpdate requires a git repository when pulling", async () => {
    const configDir = mkdtempSync(join(tmpdir(), "wp-dev-update-nogit-"));
    const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const loaded = {
        configDir,
        config: minimalWpDevConfig(),
      } as LoadedConfig;
      await expect(cmdUpdate(loaded, { skipPull: false })).rejects.toThrow(/Not a git repository/);
    } finally {
      stderrSpy.mockRestore();
      rmSync(configDir, { recursive: true, force: true });
    }
  });
});

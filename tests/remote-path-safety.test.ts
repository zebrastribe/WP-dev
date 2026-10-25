import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  assertRemotePathSafe,
  evaluatePathSafety,
  inspectLocalWpRootSafety,
  parseRemotePathSafetyOutput,
} from "../src/services/remote-path-safety.js";
import type { SshSession } from "../src/services/ssh.js";

describe("remote-path-safety", () => {
  it("parses probe output", () => {
    const parsed = parseRemotePathSafetyOutput(
      "noise\nWPDEV_PATH_SAFETY has_wp=1 child_wp=2 markers=wp-dev.config.json docker/terminal-runner.mjs\n",
    );
    expect(parsed.hasWpConfig).toBe(true);
    expect(parsed.childWpConfigCount).toBe(2);
    expect(parsed.toolingMarkers).toEqual([
      "wp-dev.config.json",
      "docker/terminal-runner.mjs",
    ]);
  });

  it("fails when path is parent of multiple sites", () => {
    const report = evaluatePathSafety({
      hasWpConfig: false,
      childWpConfigCount: 2,
      toolingMarkers: [],
      pathLabel: "/var/www",
      envLabel: "production",
    });
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => i.code === "parent_of_sites")).toBe(true);
  });

  it("fails when wp-dev tooling is in the docroot", () => {
    const report = evaluatePathSafety({
      hasWpConfig: true,
      childWpConfigCount: 0,
      toolingMarkers: ["wp-dev.config.json"],
      pathLabel: "/var/www/live",
      envLabel: "production",
    });
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => i.code === "wpdev_tooling_in_docroot")).toBe(true);
  });

  it("warns on nested wp installs under a valid root", () => {
    const report = evaluatePathSafety({
      hasWpConfig: true,
      childWpConfigCount: 1,
      toolingMarkers: [],
      pathLabel: "/var/www/live",
      envLabel: "staging",
    });
    expect(report.ok).toBe(true);
    expect(report.issues.some((i) => i.code === "nested_wp_installs" && i.level === "warn")).toBe(
      true,
    );
  });

  it("inspectLocalWpRootSafety detects wp-dev checkout as wpRoot", () => {
    const dir = mkdtempSync(join(tmpdir(), "wpdev-path-safety-"));
    try {
      writeFileSync(join(dir, "wp-config.php"), "<?php\n");
      writeFileSync(join(dir, "wp-dev.config.json"), "{}\n");
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ name: "wp-dev", version: "0.1.0" }),
      );
      const report = inspectLocalWpRootSafety(dir, "local");
      expect(report.ok).toBe(false);
      expect(report.toolingMarkers.length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("assertRemotePathSafe allows missing wp-config when seeding staging", async () => {
    const ssh = {
      exec: async () => ({
        code: 0,
        stdout: "WPDEV_PATH_SAFETY has_wp=0 child_wp=0 markers=\n",
        stderr: "",
      }),
    } as unknown as SshSession;
    await expect(
      assertRemotePathSafe(ssh, "/var/www/staging", "staging", {
        allowMissingWpConfig: true,
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(assertRemotePathSafe(ssh, "/var/www/staging", "staging")).rejects.toThrow(
      /Refusing staging/,
    );
  });

  it("inspectLocalWpRootSafety accepts a normal wordpress root", () => {
    const dir = mkdtempSync(join(tmpdir(), "wpdev-path-ok-"));
    try {
      writeFileSync(join(dir, "wp-config.php"), "<?php\n");
      mkdirSync(join(dir, "wp-content"));
      const report = inspectLocalWpRootSafety(dir, "local");
      expect(report.ok).toBe(true);
      expect(report.issues).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createWordPressFixture, minimalWpDevConfig } from "./helpers/fixtures.js";
import type { LoadedConfig } from "../src/config/load.js";

const execaMock = vi.fn();
vi.mock("execa", () => ({
  execa: (...args: unknown[]) => execaMock(...args),
}));

describe("runSyncPreview", () => {
  let configDir: string;
  let loaded: LoadedConfig;

  beforeEach(() => {
    execaMock.mockReset();
    configDir = mkdtempSync(join(tmpdir(), "wp-dev-preview-"));
    createWordPressFixture(configDir);
    loaded = {
      configDir,
      config: minimalWpDevConfig(),
    };
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  it("parses rsync itemize output for push preview", async () => {
    execaMock.mockResolvedValueOnce({
      exitCode: 0,
      stdout: ">f+++++++++ wp-content/plugins/new-plugin/file.php\n",
      stderr: "",
    });
    const { runSyncPreview } = await import("../src/services/sync-preview.js");
    const result = await runSyncPreview(loaded, "staging", "push");
    expect(result.direction).toBe("push");
    expect(result.dryRun).toBe(true);
    expect(result.changes.added.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.includes("remote database"))).toBe(true);
  });

  it("throws when rsync preview fails", async () => {
    execaMock.mockResolvedValueOnce({
      exitCode: 23,
      stdout: "",
      stderr: "permission denied",
    });
    const { runSyncPreview } = await import("../src/services/sync-preview.js");
    await expect(runSyncPreview(loaded, "production", "pull")).rejects.toThrow(
      /Sync preview failed/,
    );
  });
});

describe("wpcli helpers", () => {
  let configDir: string;

  beforeEach(() => {
    execaMock.mockReset();
    configDir = mkdtempSync(join(tmpdir(), "wp-dev-wpcli-"));
    createWordPressFixture(configDir);
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  it("parseSearchReplaceReplacementCount extracts count", async () => {
    const { parseSearchReplaceReplacementCount } = await import("../src/services/wpcli.js");
    expect(parseSearchReplaceReplacementCount("Success: Made 42 replacements.")).toBe(42);
    expect(parseSearchReplaceReplacementCount("nothing")).toBe(0);
  });

  it("remoteWpPathFlag quotes path", async () => {
    const { remoteWpPathFlag } = await import("../src/services/wpcli.js");
    expect(remoteWpPathFlag("/var/www/html")).toBe("--path='/var/www/html'");
  });

  it("wpLocalRaw invokes docker compose with wp args", async () => {
    execaMock.mockResolvedValueOnce({ exitCode: 0, stdout: "ok", stderr: "" });
    const { wpLocalRaw } = await import("../src/services/wpcli.js");
    const config = minimalWpDevConfig();
    const r = await wpLocalRaw(configDir, config, ["option", "get", "siteurl"]);
    expect(r.exitCode).toBe(0);
    expect(execaMock.mock.calls[0][0]).toBe("docker");
    const args = execaMock.mock.calls[0][1] as string[];
    expect(args.join(" ")).toContain("run");
    expect(args).toContain("wp");
  });
});

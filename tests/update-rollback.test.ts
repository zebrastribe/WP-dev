/**
 * P1.9 / §27 F — tool snapshot + rollback on failure; wordpress/ untouched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { minimalWpDevConfig } from "./helpers/fixtures.js";
import type { LoadedConfig } from "../src/config/load.js";

function git(cwd: string, args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr || r.stdout}`);
  }
  return (r.stdout || "").trim();
}

const execaMock = vi.fn();

vi.mock("execa", () => ({
  execa: (...args: unknown[]) => execaMock(...args),
}));

vi.mock("../src/services/update-preflight.js", () => ({
  collectUpdatePreflight: vi.fn().mockResolvedValue({
    isGitRepo: true,
    dirty: false,
    warnings: [],
    info: [],
    blocking: [],
  }),
  formatUpdatePreflight: vi.fn().mockReturnValue("preflight ok"),
}));

vi.mock("../src/fs/update-lock.js", () => ({
  acquireUpdateLock: vi.fn().mockReturnValue(true),
  releaseUpdateLock: vi.fn(),
}));

vi.mock("@wpdev/sync-engine", () => ({
  acquireSyncLock: vi.fn().mockReturnValue({ path: "lock" }),
  releaseSyncLock: vi.fn(),
}));

vi.mock("../src/commands/down.js", () => ({
  cmdDown: vi.fn(),
}));

vi.mock("../src/commands/up.js", () => ({
  cmdUp: vi.fn(),
}));

describe("wp-dev update rollback (P1.9)", () => {
  let configDir: string;
  let siteMarker: string;

  beforeEach(() => {
    execaMock.mockReset();
    configDir = mkdtempSync(join(tmpdir(), "wp-dev-update-rb-"));
    mkdirSync(join(configDir, "wordpress", "wp-content"), { recursive: true });
    mkdirSync(join(configDir, "dist"), { recursive: true });
    siteMarker = join(configDir, "wordpress", "wp-content", "site-marker.txt");
    writeFileSync(siteMarker, "site-must-survive\n");
    writeFileSync(join(configDir, "dist", "cli.js"), "#!/usr/bin/env node\nconsole.log('help');\n");

    git(configDir, ["init"]);
    git(configDir, ["config", "user.email", "t@example.com"]);
    git(configDir, ["config", "user.name", "T"]);
    writeFileSync(join(configDir, "tool.txt"), "v1");
    git(configDir, ["add", "."]);
    git(configDir, ["commit", "-m", "snap"]);
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  it("on build failure: rolls back to snapshot SHA and leaves wordpress/ marker intact", async () => {
    const head = git(configDir, ["rev-parse", "HEAD"]);
    const calls: string[] = [];

    execaMock.mockImplementation(async (cmd: string, args?: string[], opts?: { cwd?: string }) => {
      const shell = Array.isArray(args) ? String(args[1] ?? "") : "";
      const label = `${cmd} ${(args ?? []).join(" ")}`.trim();
      calls.push(label);

      if (cmd === "git" && Array.isArray(args) && args.includes("rev-parse")) {
        return { stdout: head, stderr: "", exitCode: 0 };
      }
      if (cmd === "bash" && shell === "npm run build") {
        throw new Error("build boom");
      }
      if (cmd === "bash" && shell.includes("npm install && npm run build")) {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      if (cmd === "git" && Array.isArray(args) && args.includes("reset")) {
        expect(args).toContain(head);
        expect(opts?.cwd).toBe(configDir);
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      if (cmd === "node" && Array.isArray(args) && args.includes("--help")) {
        return { stdout: "help", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const { cmdUpdate } = await import("../src/commands/update.js");
    const loaded: LoadedConfig = {
      configDir,
      config: minimalWpDevConfig(),
    };

    await expect(
      cmdUpdate(loaded, { skipPull: true, noAdmin: true, noRestart: true }),
    ).rejects.toThrow(/build boom/);

    expect(calls.some((c) => c.includes("reset --hard") && c.includes(head))).toBe(true);
    expect(calls.some((c) => c.includes("npm install && npm run build"))).toBe(true);
    expect(readFileSync(siteMarker, "utf8")).toBe("site-must-survive\n");
    expect(calls.join("\n")).not.toMatch(/wordpress\/wp-content/);
  });

  it("verifyWpDevCli refuses missing dist/cli.js", async () => {
    rmSync(join(configDir, "dist"), { recursive: true, force: true });
    const { verifyWpDevCli } = await import("../src/commands/update.js");
    await expect(verifyWpDevCli(configDir)).rejects.toThrow(/missing/);
  });
});

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const execaMock = vi.fn();
vi.mock("execa", () => ({
  execa: (...args: unknown[]) => execaMock(...args),
}));

const resolveHostIdentityMock = vi.fn();
vi.mock("../src/utils/host-paths.js", () => ({
  resolveHostIdentity: (...args: unknown[]) => resolveHostIdentityMock(...args),
}));

describe("theme-build chown", () => {
  let tempDir: string;
  let themeDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "wp-dev-theme-build-"));
    themeDir = join(tempDir, "theme");
    mkdirSync(themeDir, { recursive: true });
    resolveHostIdentityMock.mockReturnValue({ uid: 1001, gid: 1001 });
    execaMock.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("chowns node_modules after npm ci", async () => {
    mkdirSync(join(themeDir, "node_modules"), { recursive: true });
    mkdirSync(join(themeDir, "theme"), { recursive: true });
    writeFileSync(join(themeDir, "package.json"), '{"scripts":{"production":"echo ok"}}');
    writeFileSync(join(themeDir, "theme", "style.css"), "/* Theme Name: Test */");
    writeFileSync(join(themeDir, "theme", "functions.php"), "<?php // theme functions");

    const { cmdThemeBuild } = await import("../src/commands/theme-build.js");
    const loaded = {
      configDir: tempDir,
      config: {
        project: "test",
        local: { path: tempDir, wpRoot: tempDir, themePath: themeDir, url: "http://localhost" },
        staging: { host: "s", user: "u", path: "/p", url: "http://s" },
        production: { host: "p", user: "u", path: "/p", url: "http://p" },
      },
    };

    await cmdThemeBuild(loaded as never, { quiet: true });

    const chownCalls = execaMock.mock.calls.filter(
      (call: unknown[]) => call[0] === "chown",
    );
    expect(chownCalls.length).toBeGreaterThanOrEqual(1);
    expect(chownCalls.some((c: unknown[]) => 
      Array.isArray(c[1]) && c[1].includes("1001:1001") && String(c[1][2]).includes("node_modules")
    )).toBe(true);
  });

  it("chowns build artifacts with host uid:gid from resolveHostIdentity", async () => {
    resolveHostIdentityMock.mockReturnValue({ uid: 501, gid: 20 });
    mkdirSync(join(themeDir, "node_modules"), { recursive: true });
    mkdirSync(join(themeDir, "dist"), { recursive: true });
    mkdirSync(join(themeDir, "theme"), { recursive: true });
    writeFileSync(join(themeDir, "package.json"), '{"scripts":{"production":"echo ok"}}');
    writeFileSync(join(themeDir, "theme", "style.css"), "/* Theme Name: Test */");
    writeFileSync(join(themeDir, "theme", "functions.php"), "<?php // theme functions");

    const { cmdThemeBuild } = await import("../src/commands/theme-build.js");
    const loaded = {
      configDir: tempDir,
      config: {
        project: "test",
        local: { path: tempDir, wpRoot: tempDir, themePath: themeDir, url: "http://localhost" },
        staging: { host: "s", user: "u", path: "/p", url: "http://s" },
        production: { host: "p", user: "u", path: "/p", url: "http://p" },
      },
    };

    await cmdThemeBuild(loaded as never, { quiet: true });

    const chownCalls = execaMock.mock.calls.filter(
      (call: unknown[]) => call[0] === "chown",
    );
    expect(chownCalls.some((c: unknown[]) =>
      Array.isArray(c[1]) && c[1].includes("501:20")
    )).toBe(true);
  });

  it("chowns in finally block even when npm ci fails", async () => {
    mkdirSync(join(themeDir, "node_modules"), { recursive: true });
    mkdirSync(join(themeDir, "theme"), { recursive: true });
    writeFileSync(join(themeDir, "package.json"), '{"scripts":{"production":"echo ok"}}');
    writeFileSync(join(themeDir, "theme", "style.css"), "/* Theme Name: Test */");
    writeFileSync(join(themeDir, "theme", "functions.php"), "<?php // theme functions");

    execaMock.mockImplementation(async (cmd: string) => {
      if (cmd === "npm") throw new Error("npm ci failed");
      return { exitCode: 0 };
    });

    const { cmdThemeBuild } = await import("../src/commands/theme-build.js");
    const loaded = {
      configDir: tempDir,
      config: {
        project: "test",
        local: { path: tempDir, wpRoot: tempDir, themePath: themeDir, url: "http://localhost" },
        staging: { host: "s", user: "u", path: "/p", url: "http://s" },
        production: { host: "p", user: "u", path: "/p", url: "http://p" },
      },
    };

    await expect(cmdThemeBuild(loaded as never, { quiet: true })).rejects.toThrow();

    const chownCalls = execaMock.mock.calls.filter(
      (call: unknown[]) => call[0] === "chown",
    );
    expect(chownCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("skips chown for directories that do not exist", async () => {
    mkdirSync(join(themeDir, "theme"), { recursive: true });
    writeFileSync(join(themeDir, "package.json"), '{"scripts":{"production":"echo ok"}}');
    writeFileSync(join(themeDir, "theme", "style.css"), "/* Theme Name: Test */");
    writeFileSync(join(themeDir, "theme", "functions.php"), "<?php // theme functions");

    const { cmdThemeBuild } = await import("../src/commands/theme-build.js");
    const loaded = {
      configDir: tempDir,
      config: {
        project: "test",
        local: { path: tempDir, wpRoot: tempDir, themePath: themeDir, url: "http://localhost" },
        staging: { host: "s", user: "u", path: "/p", url: "http://s" },
        production: { host: "p", user: "u", path: "/p", url: "http://p" },
      },
    };

    await cmdThemeBuild(loaded as never, { quiet: true });

    const chownCalls = execaMock.mock.calls.filter(
      (call: unknown[]) => call[0] === "chown",
    );
    expect(chownCalls.every((c: unknown[]) =>
      !String(c[1]?.[2] ?? "").includes("node_modules")
    )).toBe(true);
  });
});

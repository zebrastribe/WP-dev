import { describe, expect, it, vi } from "vitest";
import {
  UPDATE_WORDPRESS_SAFETY,
  buildUpdateSteps,
  cmdUpdate,
} from "../src/commands/update.js";
import { collectUpdatePreflight } from "../src/services/update-preflight.js";
import { minimalWpDevConfig } from "./helpers/fixtures.js";
import type { LoadedConfig } from "../src/config/load.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execa } from "execa";

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
      expect(out).toContain("Pre-flight check");
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

  it("buildUpdateSteps uses --autostash for safe rebasing", () => {
    const steps = buildUpdateSteps({});
    const pullStep = steps.find((s) => s.shell.includes("git"));
    expect(pullStep).toBeDefined();
    expect(pullStep!.shell).toContain("--autostash");
    expect(pullStep!.shell).toContain("--rebase");
  });
});

describe("update preflight", () => {
  it("warns that preflight does not fetch from remote", async () => {
    // Use a temp git repo for testing
    const configDir = mkdtempSync(join(tmpdir(), "wp-dev-preflight-"));
    try {
      // Initialize a git repo with an upstream
      await execa("git", ["init"], { cwd: configDir });
      await execa("git", ["config", "user.email", "test@example.com"], { cwd: configDir });
      await execa("git", ["config", "user.name", "Test"], { cwd: configDir });
      writeFileSync(join(configDir, "test.txt"), "test");
      await execa("git", ["add", "."], { cwd: configDir });
      await execa("git", ["commit", "-m", "initial"], { cwd: configDir });
      // Create a fake remote tracking branch
      await execa("git", ["checkout", "-b", "test-upstream"], { cwd: configDir });
      await execa("git", ["checkout", "-b", "main"], { cwd: configDir });
      await execa("git", ["branch", "-u", "test-upstream"], { cwd: configDir });

      const preflight = await collectUpdatePreflight(configDir);
      expect(preflight.isGitRepo).toBe(true);
      // Should note about stale fetch (info, not warning)
      expect(preflight.info.some((n) => n.includes("preflight does not fetch"))).toBe(true);
      // Should not be in warnings
      expect(preflight.warnings.some((w) => w.includes("preflight does not fetch"))).toBe(false);
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it("git autostash does not affect existing manual stashes", async () => {
    // This test verifies git's autostash behavior is safe with existing stashes
    const configDir = mkdtempSync(join(tmpdir(), "wp-dev-autostash-"));
    try {
      // Initialize a git repo
      await execa("git", ["init"], { cwd: configDir });
      await execa("git", ["config", "user.email", "test@example.com"], { cwd: configDir });
      await execa("git", ["config", "user.name", "Test"], { cwd: configDir });
      writeFileSync(join(configDir, "file1.txt"), "initial");
      await execa("git", ["add", "."], { cwd: configDir });
      await execa("git", ["commit", "-m", "initial"], { cwd: configDir });

      // Create an existing manual stash
      writeFileSync(join(configDir, "file1.txt"), "stashed change 1");
      await execa("git", ["stash", "push", "-m", "user stash 1"], { cwd: configDir });
      writeFileSync(join(configDir, "file1.txt"), "stashed change 2");
      await execa("git", ["stash", "push", "-m", "user stash 2"], { cwd: configDir });

      // Count existing stashes
      const stashListBefore = await execa("git", ["stash", "list"], { cwd: configDir });
      const stashCountBefore = stashListBefore.stdout.split("\n").filter(Boolean).length;
      expect(stashCountBefore).toBe(2);

      // Create local changes that would be autostashed during rebase
      writeFileSync(join(configDir, "file1.txt"), "local uncommitted change");

      // Simulate what update does: git pull --rebase --autostash
      // Since there's nothing to pull, this just autostashes and applies
      await execa("git", ["rebase", "--autostash", "HEAD"], { cwd: configDir });

      // Verify existing stashes are preserved
      const stashListAfter = await execa("git", ["stash", "list"], { cwd: configDir });
      const stashCountAfter = stashListAfter.stdout.split("\n").filter(Boolean).length;
      expect(stashCountAfter).toBe(stashCountBefore);

      // Verify the stash messages are unchanged
      expect(stashListAfter.stdout).toContain("user stash 1");
      expect(stashListAfter.stdout).toContain("user stash 2");
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it("autostash with bare remote preserves stashes on conflict rebase abort", async () => {
    const bareRemote = mkdtempSync(join(tmpdir(), "wp-dev-bare-"));
    const localRepo = mkdtempSync(join(tmpdir(), "wp-dev-local-"));
    try {
      // Create a bare remote with main as default branch
      await execa("git", ["init", "--bare", "--initial-branch=main"], { cwd: bareRemote });

      // Initialize local repo and add remote
      await execa("git", ["init", "--initial-branch=main"], { cwd: localRepo });
      await execa("git", ["remote", "add", "origin", bareRemote], { cwd: localRepo });
      await execa("git", ["config", "user.email", "test@example.com"], { cwd: localRepo });
      await execa("git", ["config", "user.name", "Test"], { cwd: localRepo });

      // Create initial commit and push
      writeFileSync(join(localRepo, "file.txt"), "initial");
      await execa("git", ["add", "."], { cwd: localRepo });
      await execa("git", ["commit", "-m", "initial"], { cwd: localRepo });
      await execa("git", ["push", "-u", "origin", "main"], { cwd: localRepo });

      // Create a stash
      writeFileSync(join(localRepo, "file.txt"), "stashed content");
      await execa("git", ["stash", "push", "-m", "user stash"], { cwd: localRepo });

      // Create conflicting upstream commit
      await execa("git", ["checkout", "-b", "temp"], { cwd: localRepo });
      writeFileSync(join(localRepo, "file.txt"), "upstream change");
      await execa("git", ["commit", "-am", "upstream"], { cwd: localRepo });
      await execa("git", ["push", "origin", "temp:main", "-f"], { cwd: localRepo });
      await execa("git", ["checkout", "main"], { cwd: localRepo });
      await execa("git", ["branch", "-D", "temp"], { cwd: localRepo });

      // Make local change
      writeFileSync(join(localRepo, "file.txt"), "local change");
      await execa("git", ["commit", "-am", "local"], { cwd: localRepo });

      // Verify stash before
      const stashBefore = await execa("git", ["stash", "list"], { cwd: localRepo });
      expect(stashBefore.stdout).toContain("user stash");

      // Try to pull with autostash - will fail due to conflict
      const pullResult = await execa(
        "git",
        ["pull", "--rebase", "--autostash", "origin", "main"],
        { cwd: localRepo, reject: false },
      );
      expect(pullResult.exitCode).not.toBe(0);

      // Abort the rebase
      await execa("git", ["rebase", "--abort"], { cwd: localRepo });

      // Verify stash is still there after abort
      const stashAfter = await execa("git", ["stash", "list"], { cwd: localRepo });
      expect(stashAfter.stdout).toContain("user stash");
    } finally {
      rmSync(bareRemote, { recursive: true, force: true });
      rmSync(localRepo, { recursive: true, force: true });
    }
  });
});

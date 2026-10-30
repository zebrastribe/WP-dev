import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  restoreEnvConfirmOk,
  wpdevPullPushCommand,
  wpdevPushThemeCommand,
} from "../docker/runner-sync-gates.mjs";

describe("runner-remote-env.mjs", () => {
  it("rejects shell metacharacters in config fields", () => {
    const src = readFileSync(
      join(process.cwd(), "docker/runner-remote-env.mjs"),
      "utf8",
    );
    expect(src).toContain("invalid_remote_fields");
    expect(src).toContain("SAFE");
    expect(src).not.toContain('eval "$CFG"');
  });

  it("terminal-runner backs up via CLI (disk preflight) and scopes lists to project", () => {
    const src = readFileSync(
      join(process.cwd(), "docker/terminal-runner.mjs"),
      "utf8",
    );
    expect(src).toContain("npm run wp-dev -- backup");
    expect(src).toContain("readProjectId");
    expect(src).not.toContain('eval "$CFG"');
  });
});

describe("CLI logging", () => {
  it("runWithConfig logs exit code when command fails", () => {
    const cli = readFileSync(join(process.cwd(), "src/cli.ts"), "utf8");
    expect(cli).toContain("finished exit=${exitCode}");
    expect(cli).toMatch(/threw.*exitCode !== 0/);
  });

  it("runWithConfig logs finished ok when command succeeds", () => {
    const cli = readFileSync(join(process.cwd(), "src/cli.ts"), "utf8");
    expect(cli).toContain("finished ok");
  });

  it("runWithConfig does not rethrow to avoid duplicate stack dumps", () => {
    const cli = readFileSync(join(process.cwd(), "src/cli.ts"), "utf8");
    expect(cli).toContain("Do not rethrow");
  });

  it("runWithConfig detects expected refusals and suppresses stack traces", () => {
    const cli = readFileSync(join(process.cwd(), "src/cli.ts"), "utf8");
    expect(cli).toContain("expectedRefuse");
    expect(cli).toMatch(/Restore refused|Path safety FAIL|Refusing to/);
  });
});

describe("pull/push safety guards", () => {
  it("pull rolls back local DB on sync failure when pre-pull backup exists", () => {
    const pull = readFileSync(join(process.cwd(), "src/commands/pull.ts"), "utf8");
    const wpcli = readFileSync(join(process.cwd(), "src/services/wpcli.ts"), "utf8");
    expect(pull).toContain("rolling back local DB");
    expect(pull).toContain("verifyLocalSiteUrls");
    expect(pull).toContain("confirmRemoteTarget");
    expect(pull).toContain("confirmHost");
    expect(wpcli).toContain("--precise");
    expect(wpcli).toContain("--all-tables-with-prefix");
  });

  it("pull and pull-theme reconcile permissions after rsync (FS_METHOD=direct)", () => {
    const pull = readFileSync(join(process.cwd(), "src/commands/pull.ts"), "utf8");
    const theme = readFileSync(join(process.cwd(), "src/commands/pull-theme.ts"), "utf8");
    expect(pull).toContain("runLocalWordpressFileMutation");
    expect(theme).toContain("runLocalWordpressFileMutation");
  });

  it("push confirms staging and rolls back remote DB on failure", () => {
    const src = readFileSync(join(process.cwd(), "src/commands/push.ts"), "utf8");
    expect(src).toContain("confirmRemoteTarget");
    expect(src).toContain("confirmHost");
    expect(src).toContain("rolling back remote DB");
    expect(src).toContain("verifyRemoteSiteUrls");
  });

  it("restore creates pre-restore backup", () => {
    const src = readFileSync(join(process.cwd(), "src/commands/restore.ts"), "utf8");
    expect(src).toContain("pre-restore");
    expect(src).toContain("confirmRemoteTarget");
  });
});

describe("runner sync gates (behavioral)", () => {
  it("wpdevPullPushCommand refuses staging without confirm host", () => {
    expect(wpdevPullPushCommand("pull", "staging", "")).toBe(null);
    expect(wpdevPullPushCommand("push", "staging", "")).toBe(null);
  });

  it("wpdevPullPushCommand refuses production without SYNC_PRODUCTION token", () => {
    expect(wpdevPullPushCommand("pull", "production", "")).toBe(null);
    expect(wpdevPullPushCommand("push", "production", "wrong")).toBe(null);
    expect(wpdevPullPushCommand("push", "production", "SYNC_PRODUCTION")).toMatch(/push production/);
  });

  it("wpdevPullPushCommand allows staging with confirm host", () => {
    const cmd = wpdevPullPushCommand("pull", "staging", "staging.example.com");
    expect(cmd).toMatch(/pull staging/);
    expect(cmd).toContain("--confirm-host staging.example.com");
  });

  it("wpdevPushThemeCommand refuses without proper confirm", () => {
    expect(wpdevPushThemeCommand("staging", "", false)).toBe(null);
    expect(wpdevPushThemeCommand("production", "", false)).toBe(null);
    expect(wpdevPushThemeCommand("production", "wrong", false)).toBe(null);
  });

  it("wpdevPushThemeCommand allows production with SYNC_PRODUCTION", () => {
    expect(wpdevPushThemeCommand("production", "SYNC_PRODUCTION", false)).toMatch(/push theme production/);
  });

  it("restoreEnvConfirmOk refuses staging without confirm", () => {
    expect(restoreEnvConfirmOk("staging", "")).toBe(false);
    expect(restoreEnvConfirmOk("staging", "staging.host")).toBe(true);
  });

  it("restoreEnvConfirmOk refuses production without RESTORE_PRODUCTION", () => {
    expect(restoreEnvConfirmOk("production", "")).toBe(false);
    expect(restoreEnvConfirmOk("production", "wrong")).toBe(false);
    expect(restoreEnvConfirmOk("production", "RESTORE_PRODUCTION")).toBe(true);
  });

  it("restoreEnvConfirmOk allows local without confirm", () => {
    expect(restoreEnvConfirmOk("local", "")).toBe(true);
  });

  it("rejects invalid env names", () => {
    expect(wpdevPullPushCommand("pull", "invalid", "")).toBe(null);
    expect(restoreEnvConfirmOk("invalid", "")).toBe(false);
  });
});

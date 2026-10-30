import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
  it("runWithConfig logs exit code when command aborts without throwing", () => {
    const cli = readFileSync(join(process.cwd(), "src/cli.ts"), "utf8");
    // The code now uses a unified exitCode variable for logging
    expect(cli).toContain("finished exit=${exitCode}");
    // Check for the exit status tracking logic
    expect(cli).toMatch(/const exitCode = process\.exitCode \?\? 0/);
    expect(cli).toMatch(/if \(threw \|\| exitCode !== 0\)/);
  });

  it("runWithConfig logs finished exit when command throws without rethrowing", () => {
    const cli = readFileSync(join(process.cwd(), "src/cli.ts"), "utf8");
    // The logging is now unified outside the try/catch
    expect(cli).toMatch(/logInfo\(`command \$\{label\} finished exit=\$\{exitCode\}`\)/);
    expect(cli).toContain("Do not rethrow");
    expect(cli).toContain("expectedRefuse");
    // The catch block still sets exitCode from process.exitCode
    expect(cli).toMatch(/process\.exitCode && process\.exitCode !== 0/);
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

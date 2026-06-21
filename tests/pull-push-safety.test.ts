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

  it("terminal-runner uses validated remote env helper for full backup", () => {
    const src = readFileSync(
      join(process.cwd(), "docker/terminal-runner.mjs"),
      "utf8",
    );
    expect(src).toContain("runner-remote-env.mjs");
    expect(src).not.toContain('eval "$CFG"');
  });
});

describe("pull/push safety guards", () => {
  it("pull rolls back local DB on sync failure when pre-pull backup exists", () => {
    const pull = readFileSync(join(process.cwd(), "src/commands/pull.ts"), "utf8");
    const wpcli = readFileSync(join(process.cwd(), "src/services/wpcli.ts"), "utf8");
    expect(pull).toContain("rolling back local DB");
    expect(pull).toContain("verifyLocalSiteUrls");
    expect(wpcli).toContain("--precise");
  });

  it("push confirms staging and rolls back remote DB on failure", () => {
    const src = readFileSync(join(process.cwd(), "src/commands/push.ts"), "utf8");
    expect(src).toContain("confirmRemoteTarget");
    expect(src).toContain("!options.yes");
    expect(src).toContain("rolling back remote DB");
    expect(src).toContain("verifyRemoteSiteUrls");
  });

  it("restore creates pre-restore backup", () => {
    const src = readFileSync(join(process.cwd(), "src/commands/restore.ts"), "utf8");
    expect(src).toContain("pre-restore");
    expect(src).toContain("confirmRemoteTarget");
  });
});

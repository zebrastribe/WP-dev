import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { minimalWpDevConfig } from "./helpers/fixtures.js";
import type { LoadedConfig } from "../src/config/load.js";

const rsyncPullMock = vi.fn();
const rsyncPushMock = vi.fn();

vi.mock("../src/services/rsync.js", () => ({
  rsyncPull: (...args: unknown[]) => rsyncPullMock(...args),
  rsyncPush: (...args: unknown[]) => rsyncPushMock(...args),
}));

vi.mock("../src/utils/host-prereq.js", () => ({
  assertHostSyncTools: vi.fn(),
}));

function makeLoaded(configDir: string, config = minimalWpDevConfig()): LoadedConfig {
  mkdirSync(join(configDir, "docker"), { recursive: true });
  mkdirSync(join(configDir, "wordpress"), { recursive: true });
  writeFileSync(join(configDir, "docker", ".env"), "WP_PORT=8888\n");
  return { configDir, config };
}

describe("cmdPull orchestration", () => {
  let loaded: LoadedConfig;

  beforeEach(() => {
    rsyncPullMock.mockReset();
    rsyncPullMock.mockResolvedValue(undefined);
    loaded = makeLoaded(mkdtempSync(join(tmpdir(), "wp-dev-pull-")));
  });

  it("dry-run only calls rsyncPull", async () => {
    const { cmdPull } = await import("../src/commands/pull.js");
    await cmdPull(loaded, "staging", { dryRun: true, backupLocal: true });
    expect(rsyncPullMock).toHaveBeenCalledTimes(1);
    expect(rsyncPullMock.mock.calls[0][2]).toMatchObject({ dryRun: true });
  });

  it("refuses pull when local.url port mismatches WP_PORT", async () => {
    loaded.config.local.url = "http://localhost:9999";
    const { cmdPull } = await import("../src/commands/pull.js");
    await expect(
      cmdPull(loaded, "production", { dryRun: false, backupLocal: true }),
    ).rejects.toThrow(/Refusing to pull/);
  });
});

describe("cmdPush orchestration", () => {
  let loaded: LoadedConfig;

  beforeEach(() => {
    rsyncPushMock.mockReset();
    rsyncPushMock.mockResolvedValue(undefined);
    loaded = makeLoaded(mkdtempSync(join(tmpdir(), "wp-dev-push-")));
  });

  it("dry-run only calls rsyncPush", async () => {
    const { cmdPush } = await import("../src/commands/push.js");
    await cmdPush(loaded, "staging", { dryRun: true });
    expect(rsyncPushMock).toHaveBeenCalledTimes(1);
    expect(rsyncPushMock.mock.calls[0][2]).toMatchObject({ dryRun: true });
  });
});

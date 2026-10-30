import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { minimalWpDevConfig } from "./helpers/fixtures.js";
import type { LoadedConfig } from "../src/config/load.js";

const rsyncPullMock = vi.fn();
const rsyncPushMock = vi.fn();
const connectSshMock = vi.fn();
const cmdSimplySetupStagingDnsMock = vi.fn();

vi.mock("../src/services/rsync.js", () => ({
  rsyncPull: (...args: unknown[]) => rsyncPullMock(...args),
  rsyncPush: (...args: unknown[]) => rsyncPushMock(...args),
}));

vi.mock("../src/services/ssh.js", () => ({
  connectSsh: (...args: unknown[]) => connectSshMock(...args),
}));

vi.mock("../src/utils/host-prereq.js", () => ({
  assertHostSyncTools: vi.fn(),
}));

vi.mock("../src/commands/simply.js", () => ({
  cmdSimplySetupStagingDns: (...args: unknown[]) => cmdSimplySetupStagingDnsMock(...args),
}));

function mockSafeSshSession() {
  return {
    exec: vi.fn().mockResolvedValue({
      code: 0,
      stdout: "WPDEV_PATH_SAFETY has_wp=1 child_wp=0 markers=",
      stderr: "",
    }),
    dispose: vi.fn(),
  };
}

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
    connectSshMock.mockReset().mockResolvedValue(mockSafeSshSession());
    cmdSimplySetupStagingDnsMock.mockReset();
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

  it("never invokes DNS setup during pull (sync isolation)", async () => {
    loaded.config.simply = { account: "S123456" };
    loaded.config.staging = {
      ...loaded.config.staging,
      host: "staging.example.invalid",
      url: "https://staging.example.invalid",
    };
    process.env.WPDEV_SIMPLY_API_KEY = "test-api-key";
    try {
      const { cmdPull } = await import("../src/commands/pull.js");
      await cmdPull(loaded, "production", { dryRun: true, backupLocal: true });
      expect(cmdSimplySetupStagingDnsMock).not.toHaveBeenCalled();
    } finally {
      delete process.env.WPDEV_SIMPLY_API_KEY;
    }
  });
});

describe("cmdPush orchestration", () => {
  let loaded: LoadedConfig;

  beforeEach(() => {
    rsyncPushMock.mockReset();
    rsyncPushMock.mockResolvedValue(undefined);
    connectSshMock.mockReset().mockResolvedValue(mockSafeSshSession());
    loaded = makeLoaded(mkdtempSync(join(tmpdir(), "wp-dev-push-")));
  });

  it("dry-run only calls rsyncPush", async () => {
    const { cmdPush } = await import("../src/commands/push.js");
    await cmdPush(loaded, "staging", { dryRun: true });
    expect(rsyncPushMock).toHaveBeenCalledTimes(1);
    expect(rsyncPushMock.mock.calls[0][2]).toMatchObject({ dryRun: true });
  });
});

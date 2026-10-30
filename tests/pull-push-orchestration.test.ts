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
const wpLocalDbExportToFileMock = vi.fn();
const wpLocalDbImportFromFileMock = vi.fn();
const wpRemoteDbExportMock = vi.fn();
const wpLocalSearchReplaceMock = vi.fn();
const wpLocalForceSiteUrlsMock = vi.fn();
const wpLocalAlignTablePrefixAfterImportMock = vi.fn();
const isLocalWpInstalledMock = vi.fn();
const assertRemoteWpInstalledMock = vi.fn();

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

vi.mock("../src/services/wpcli.js", () => ({
  wpLocalDbExportToFile: (...args: unknown[]) => wpLocalDbExportToFileMock(...args),
  wpLocalDbImportFromFile: (...args: unknown[]) => wpLocalDbImportFromFileMock(...args),
  wpRemoteDbExport: (...args: unknown[]) => wpRemoteDbExportMock(...args),
  wpLocalSearchReplace: (...args: unknown[]) => wpLocalSearchReplaceMock(...args),
  wpLocalForceSiteUrls: (...args: unknown[]) => wpLocalForceSiteUrlsMock(...args),
  wpLocalAlignTablePrefixAfterImport: (...args: unknown[]) => wpLocalAlignTablePrefixAfterImportMock(...args),
  isLocalWpInstalled: (...args: unknown[]) => isLocalWpInstalledMock(...args),
  assertRemoteWpInstalled: (...args: unknown[]) => assertRemoteWpInstalledMock(...args),
  assertNotInTerminalContainerWithoutDocker: vi.fn(),
}));

vi.mock("../src/utils/disk-space.js", () => ({
  assertLocalFreeSpace: vi.fn(),
  assertRemoteFreeSpace: vi.fn(),
  DISK_NEED: { dbBackupLocal: 100, dbBackupRemoteTmp: 100 },
}));

vi.mock("../src/fs/index.js", () => ({
  runLocalWordpressFileMutation: async (_loaded: unknown, _opts: unknown, fn: () => Promise<void>) => fn(),
}));

vi.mock("../src/utils/sync-verify.js", () => ({
  verifyLocalSiteUrls: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("../src/utils/sync-lock.js", () => ({
  acquireSyncLock: vi.fn().mockReturnValue("mock-lock"),
  releaseSyncLock: vi.fn(),
}));

vi.mock("../src/utils/sql-dump-validate.js", () => ({
  assertValidSqlDump: vi.fn(),
}));

vi.mock("../src/utils/sql-dump-prefix.js", () => ({
  detectTablePrefixFromSqlDump: vi.fn().mockReturnValue("wp_"),
}));

function mockSafeSshSession() {
  return {
    exec: vi.fn().mockResolvedValue({
      code: 0,
      stdout: "WPDEV_PATH_SAFETY has_wp=1 child_wp=0 markers=",
      stderr: "",
    }),
    getFile: vi.fn().mockImplementation((_remote: string, local: string) => {
      writeFileSync(local, "-- wp-dev dump\nINSERT INTO `wp_options`");
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
    wpLocalDbExportToFileMock.mockReset().mockResolvedValue(undefined);
    wpLocalDbImportFromFileMock.mockReset().mockResolvedValue(undefined);
    wpRemoteDbExportMock.mockReset().mockResolvedValue(undefined);
    wpLocalSearchReplaceMock.mockReset().mockResolvedValue(undefined);
    wpLocalForceSiteUrlsMock.mockReset().mockResolvedValue(undefined);
    wpLocalAlignTablePrefixAfterImportMock.mockReset().mockResolvedValue(undefined);
    isLocalWpInstalledMock.mockReset().mockResolvedValue(false);
    assertRemoteWpInstalledMock.mockReset().mockImplementation((_ssh, path) => Promise.resolve(path));
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
    process.env.WPDEV_ASSUME_YES = "1";
    try {
      const { cmdPull } = await import("../src/commands/pull.js");
      await cmdPull(loaded, "production", { dryRun: false, backupLocal: false, yes: true });
      expect(cmdSimplySetupStagingDnsMock).not.toHaveBeenCalled();
      expect(rsyncPullMock).toHaveBeenCalledTimes(1);
      expect(rsyncPullMock.mock.calls[0][2]).toMatchObject({ dryRun: false });
    } finally {
      delete process.env.WPDEV_SIMPLY_API_KEY;
      delete process.env.WPDEV_ASSUME_YES;
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

/**
 * P1.7 — Golden pull/push step order + §24 recovery branches.
 * Mock SSH/rsync/wpcli; assert backup → transfer → import → rewrite → verify
 * and rollback-on-failure paths.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { minimalWpDevConfig } from "./helpers/fixtures.js";
import type { LoadedConfig } from "../src/config/load.js";

const steps: string[] = [];
const note = (label: string) => {
  steps.push(label);
};

const rsyncPullMock = vi.fn(async () => {
  note("rsyncPull");
});
const rsyncPushMock = vi.fn(async () => {
  note("rsyncPush");
});
const connectSshMock = vi.fn();
const wpLocalDbExportToFileMock = vi.fn(async () => {
  note("wpLocalDbExport");
});
const wpLocalDbImportFromFileMock = vi.fn(async () => {
  note("wpLocalDbImport");
});
const wpRemoteDbExportMock = vi.fn(async () => {
  note("wpRemoteDbExport");
});
const wpRemoteDbImportMock = vi.fn(async () => {
  note("wpRemoteDbImport");
});
const wpLocalSearchReplaceMock = vi.fn(async () => {
  note("wpLocalSearchReplace");
});
const wpLocalForceSiteUrlsMock = vi.fn(async () => {
  note("wpLocalForceSiteUrls");
});
const wpRemoteSearchReplaceMock = vi.fn(async () => {
  note("wpRemoteSearchReplace");
});
const wpRemoteForceSiteUrlsMock = vi.fn(async () => {
  note("wpRemoteForceSiteUrls");
});
const wpLocalAlignTablePrefixAfterImportMock = vi.fn(async () => {
  note("wpLocalAlignTablePrefix");
});
const isLocalWpInstalledMock = vi.fn();
const assertLocalWpInstalledMock = vi.fn(async () => {
  note("assertLocalWpInstalled");
});
const assertRemoteWpInstalledMock = vi.fn(async (_ssh: unknown, path: string) => path);
const resolveRemoteWpPathMock = vi.fn(async (_ssh: unknown, path: string) => ({
  installed: true,
  path,
}));
const verifyLocalSiteUrlsMock = vi.fn(async () => {
  note("verifyLocalSiteUrls");
  return { ok: true, home: "http://localhost:8888", siteurl: "http://localhost:8888", expected: "http://localhost:8888" };
});
const verifyRemoteSiteUrlsMock = vi.fn(async () => {
  note("verifyRemoteSiteUrls");
  return {
    ok: true,
    home: "https://staging.example.com",
    siteurl: "https://staging.example.com",
    expected: "https://staging.example.com",
  };
});

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

vi.mock("@wpdev/sync-engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@wpdev/sync-engine")>();
  return {
    ...actual,
    acquireSyncLock: vi.fn().mockReturnValue({ path: "mock-lock", release: vi.fn() }),
    releaseSyncLock: vi.fn(),
  };
});

vi.mock("../src/services/wpcli.js", () => ({
  wpLocalDbExportToFile: (...args: unknown[]) => wpLocalDbExportToFileMock(...args),
  wpLocalDbImportFromFile: (...args: unknown[]) => wpLocalDbImportFromFileMock(...args),
  wpRemoteDbExport: (...args: unknown[]) => wpRemoteDbExportMock(...args),
  wpRemoteDbImport: (...args: unknown[]) => wpRemoteDbImportMock(...args),
  wpLocalSearchReplace: (...args: unknown[]) => wpLocalSearchReplaceMock(...args),
  wpLocalForceSiteUrls: (...args: unknown[]) => wpLocalForceSiteUrlsMock(...args),
  wpRemoteSearchReplace: (...args: unknown[]) => wpRemoteSearchReplaceMock(...args),
  wpRemoteForceSiteUrls: (...args: unknown[]) => wpRemoteForceSiteUrlsMock(...args),
  wpLocalAlignTablePrefixAfterImport: (...args: unknown[]) =>
    wpLocalAlignTablePrefixAfterImportMock(...args),
  isLocalWpInstalled: (...args: unknown[]) => isLocalWpInstalledMock(...args),
  assertLocalWpInstalled: (...args: unknown[]) => assertLocalWpInstalledMock(...args),
  assertRemoteWpInstalled: (...args: unknown[]) => assertRemoteWpInstalledMock(...args),
  assertNotInTerminalContainerWithoutDocker: vi.fn(),
  resolveRemoteWpPath: (...args: unknown[]) => resolveRemoteWpPathMock(...args),
  wpLocalGetTablePrefix: vi.fn().mockResolvedValue("wp_"),
  wpRemoteGetTablePrefix: vi.fn().mockResolvedValue("wp_"),
  assertTablePrefixesCompatible: vi.fn(),
  wpRemoteBootstrapConfigFromRemoteDb: vi.fn(),
}));

vi.mock("../src/utils/disk-space.js", () => ({
  assertLocalFreeSpace: vi.fn(),
  assertRemoteFreeSpace: vi.fn(),
  DISK_NEED: { dbBackupLocal: 100, dbBackupRemoteTmp: 100 },
}));

vi.mock("../src/fs/index.js", () => ({
  runLocalWordpressFileMutation: async (_loaded: unknown, _opts: unknown, fn: () => Promise<void>) =>
    fn(),
}));

vi.mock("../src/utils/sync-verify.js", () => ({
  verifyLocalSiteUrls: (...args: unknown[]) => verifyLocalSiteUrlsMock(...args),
  verifyRemoteSiteUrls: (...args: unknown[]) => verifyRemoteSiteUrlsMock(...args),
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
    getFile: vi.fn().mockImplementation(async (_remote: string, local: string) => {
      note("ssh.getFile");
      writeFileSync(local, "-- wp-dev dump\nINSERT INTO `wp_options`");
    }),
    putFile: vi.fn().mockImplementation(async () => {
      note("ssh.putFile");
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

function stagingWithDb() {
  return minimalWpDevConfig({
    staging: {
      host: "staging.example.com",
      user: "deploy",
      path: "/var/www/staging",
      url: "https://staging.example.com",
      db: {
        host: "db.staging.example.com",
        name: "wp_staging",
        user: "stuser",
        password: "stpass",
      },
    },
  });
}

describe("golden pull order (P1.7)", () => {
  let loaded: LoadedConfig;

  beforeEach(() => {
    steps.length = 0;
    rsyncPullMock.mockReset().mockImplementation(async () => {
      note("rsyncPull");
    });
    connectSshMock.mockReset().mockResolvedValue(mockSafeSshSession());
    wpLocalDbExportToFileMock.mockReset().mockImplementation(async () => {
      note("wpLocalDbExport");
    });
    wpLocalDbImportFromFileMock.mockReset().mockImplementation(async () => {
      note("wpLocalDbImport");
    });
    wpRemoteDbExportMock.mockReset().mockImplementation(async () => {
      note("wpRemoteDbExport");
    });
    wpLocalSearchReplaceMock.mockReset().mockImplementation(async () => {
      note("wpLocalSearchReplace");
    });
    wpLocalForceSiteUrlsMock.mockReset().mockImplementation(async () => {
      note("wpLocalForceSiteUrls");
    });
    wpLocalAlignTablePrefixAfterImportMock.mockReset().mockImplementation(async () => {
      note("wpLocalAlignTablePrefix");
    });
    isLocalWpInstalledMock.mockReset().mockResolvedValue(true);
    assertRemoteWpInstalledMock.mockReset().mockImplementation((_ssh, path) => Promise.resolve(path));
    verifyLocalSiteUrlsMock.mockReset().mockImplementation(async () => {
      note("verifyLocalSiteUrls");
      return {
        ok: true,
        home: "http://localhost:8888",
        siteurl: "http://localhost:8888",
        expected: "http://localhost:8888",
      };
    });
    process.env.WPDEV_ASSUME_YES = "1";
    loaded = makeLoaded(mkdtempSync(join(tmpdir(), "wp-dev-golden-pull-")));
  });

  afterEach(() => {
    delete process.env.WPDEV_ASSUME_YES;
    if (loaded?.configDir) rmSync(loaded.configDir, { recursive: true, force: true });
  });

  it("orders backup → remote export → transfer → import → rewrite → verify", async () => {
    const { cmdPull } = await import("../src/commands/pull.js");
    await cmdPull(loaded, "production", {
      dryRun: false,
      backupLocal: true,
      yes: true,
    });

    const idx = (label: string) => {
      const i = steps.indexOf(label);
      expect(i, `missing step ${label} in ${JSON.stringify(steps)}`).toBeGreaterThanOrEqual(0);
      return i;
    };

    expect(idx("wpLocalDbExport")).toBeLessThan(idx("wpRemoteDbExport"));
    expect(idx("wpRemoteDbExport")).toBeLessThan(idx("ssh.getFile"));
    expect(idx("ssh.getFile")).toBeLessThan(idx("rsyncPull"));
    expect(idx("rsyncPull")).toBeLessThan(idx("wpLocalDbImport"));
    expect(idx("wpLocalDbImport")).toBeLessThan(idx("wpLocalSearchReplace"));
    expect(idx("wpLocalSearchReplace")).toBeLessThan(idx("wpLocalForceSiteUrls"));
    expect(idx("wpLocalForceSiteUrls")).toBeLessThan(idx("verifyLocalSiteUrls"));
  });

  it("§24: on post-rsync failure with pre-pull backup, rolls back local DB then rethrows", async () => {
    wpLocalDbImportFromFileMock
      .mockReset()
      .mockImplementationOnce(async () => {
        note("wpLocalDbImport");
        throw new Error("import boom");
      })
      .mockImplementationOnce(async () => {
        note("wpLocalDbImportRollback");
      });

    const { cmdPull } = await import("../src/commands/pull.js");
    await expect(
      cmdPull(loaded, "production", { dryRun: false, backupLocal: true, yes: true }),
    ).rejects.toThrow(/import boom/);

    expect(steps.indexOf("rsyncPull")).toBeLessThan(steps.indexOf("wpLocalDbImport"));
    expect(steps.indexOf("wpLocalDbImport")).toBeLessThan(steps.indexOf("wpLocalDbImportRollback"));
    expect(steps).not.toContain("verifyLocalSiteUrls");
  });
});

describe("golden push order (P1.7)", () => {
  let loaded: LoadedConfig;

  beforeEach(() => {
    steps.length = 0;
    rsyncPushMock.mockReset().mockImplementation(async () => {
      note("rsyncPush");
    });
    connectSshMock.mockReset().mockResolvedValue(mockSafeSshSession());
    wpLocalDbExportToFileMock.mockReset().mockImplementation(async () => {
      note("wpLocalDbExport");
    });
    wpRemoteDbExportMock.mockReset().mockImplementation(async () => {
      note("wpRemoteDbExport");
    });
    wpRemoteDbImportMock.mockReset().mockImplementation(async () => {
      note("wpRemoteDbImport");
    });
    wpRemoteSearchReplaceMock.mockReset().mockImplementation(async () => {
      note("wpRemoteSearchReplace");
    });
    wpRemoteForceSiteUrlsMock.mockReset().mockImplementation(async () => {
      note("wpRemoteForceSiteUrls");
    });
    assertLocalWpInstalledMock.mockReset().mockResolvedValue(undefined);
    resolveRemoteWpPathMock.mockReset().mockResolvedValue({
      installed: true,
      path: "/var/www/staging",
    });
    verifyRemoteSiteUrlsMock.mockReset().mockImplementation(async () => {
      note("verifyRemoteSiteUrls");
      return {
        ok: true,
        home: "https://staging.example.com",
        siteurl: "https://staging.example.com",
        expected: "https://staging.example.com",
      };
    });
    process.env.WPDEV_ASSUME_YES = "1";
    loaded = makeLoaded(mkdtempSync(join(tmpdir(), "wp-dev-golden-push-")), stagingWithDb());
  });

  afterEach(() => {
    delete process.env.WPDEV_ASSUME_YES;
    if (loaded?.configDir) rmSync(loaded.configDir, { recursive: true, force: true });
  });

  it("orders pre-push backup → transfer → local export → remote import → rewrite → verify", async () => {
    const { cmdPush } = await import("../src/commands/push.js");
    await cmdPush(loaded, "staging", {
      dryRun: false,
      yes: true,
      confirmHost: "staging.example.com",
    });

    const idx = (label: string) => {
      const i = steps.indexOf(label);
      expect(i, `missing step ${label} in ${JSON.stringify(steps)}`).toBeGreaterThanOrEqual(0);
      return i;
    };

    expect(idx("wpRemoteDbExport")).toBeLessThan(idx("ssh.getFile"));
    expect(idx("ssh.getFile")).toBeLessThan(idx("rsyncPush"));
    expect(idx("rsyncPush")).toBeLessThan(idx("wpLocalDbExport"));
    expect(idx("wpLocalDbExport")).toBeLessThan(idx("ssh.putFile"));
    expect(idx("ssh.putFile")).toBeLessThan(idx("wpRemoteDbImport"));
    expect(idx("wpRemoteDbImport")).toBeLessThan(idx("wpRemoteSearchReplace"));
    expect(idx("wpRemoteSearchReplace")).toBeLessThan(idx("wpRemoteForceSiteUrls"));
    expect(idx("wpRemoteForceSiteUrls")).toBeLessThan(idx("verifyRemoteSiteUrls"));
  });

  it("§24: on remote import failure, rolls back remote DB from pre-push backup then rethrows", async () => {
    wpRemoteDbImportMock
      .mockReset()
      .mockImplementationOnce(async () => {
        note("wpRemoteDbImport");
        throw new Error("remote import boom");
      })
      .mockImplementationOnce(async () => {
        note("wpRemoteDbImportRollback");
      });

    const { cmdPush } = await import("../src/commands/push.js");
    await expect(
      cmdPush(loaded, "staging", {
        dryRun: false,
        yes: true,
        confirmHost: "staging.example.com",
      }),
    ).rejects.toThrow(/remote import boom/);

    expect(steps.indexOf("rsyncPush")).toBeLessThan(steps.indexOf("wpRemoteDbImport"));
    expect(steps.indexOf("wpRemoteDbImport")).toBeLessThan(steps.indexOf("wpRemoteDbImportRollback"));
    expect(steps).not.toContain("verifyRemoteSiteUrls");
  });
});

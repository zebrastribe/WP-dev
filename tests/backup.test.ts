import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertBackupFileExists,
  backupDirFor,
  timestampedDbName,
  timestampedFullName,
  timestampedPreRestoreName,
} from "../src/services/backup.js";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { homedir } from "node:os";

describe("backup service", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-17T14:05:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("backupDirFor uses project and env under home", () => {
    expect(backupDirFor("my-site", "staging")).toBe(
      join(homedir(), ".wp-dev", "backups", "my-site", "staging"),
    );
  });

  it("timestampedDbName uses stable format", () => {
    expect(timestampedDbName()).toBe("db-2026-06-17-14-05.sql");
  });

  it("timestampedFullName uses tar.gz suffix", () => {
    expect(timestampedFullName()).toBe("full-2026-06-17-14-05.tar.gz");
  });

  it("timestampedPreRestoreName is distinct", () => {
    expect(timestampedPreRestoreName()).toBe("pre-restore-2026-06-17-14-05.sql");
  });

  it("assertBackupFileExists throws when missing", () => {
    expect(() => assertBackupFileExists("/nonexistent/wp-dev-backup.sql")).toThrow(
      /Backup file not found/,
    );
  });

  it("assertBackupFileExists passes when file exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "wp-dev-backup-"));
    const file = join(dir, "dump.sql");
    writeFileSync(file, "-- sql");
    expect(() => assertBackupFileExists(file)).not.toThrow();
    rmSync(dir, { recursive: true, force: true });
  });
});

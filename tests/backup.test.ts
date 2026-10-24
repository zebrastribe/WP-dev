import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertBackupFileExists,
  backupDirFor,
  chownBackupArtifact,
  FULL_BACKUP_TAR_EXCLUDES,
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

  it("timestampedDbName includes seconds and a unique suffix", () => {
    const name = timestampedDbName();
    expect(name).toMatch(/^db-2026-06-17-14-05-\d{2}-\d{3}-[a-z0-9]+\.sql$/);
  });

  it("timestampedFullName uses tar.gz suffix", () => {
    expect(timestampedFullName()).toMatch(/^full-2026-06-17-14-05-\d{2}-\d{3}-[a-z0-9]+\.tar\.gz$/);
  });

  it("timestampedPreRestoreName is distinct", () => {
    expect(timestampedPreRestoreName()).toMatch(/^pre-restore-2026-06-17-14-05-\d{2}-\d{3}-[a-z0-9]+\.sql$/);
    expect(timestampedDbName()).not.toBe(timestampedDbName());
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

  it("FULL_BACKUP_TAR_EXCLUDES drops build junk from archives", () => {
    expect(FULL_BACKUP_TAR_EXCLUDES).toContain("node_modules");
    expect(FULL_BACKUP_TAR_EXCLUDES).toContain(".git");
  });

  it("chownBackupArtifact does not throw on a normal file", () => {
    const dir = mkdtempSync(join(tmpdir(), "wp-dev-backup-chown-"));
    const file = join(dir, "dump.sql");
    writeFileSync(file, "-- sql");
    expect(() => chownBackupArtifact(file, dir)).not.toThrow();
    rmSync(dir, { recursive: true, force: true });
  });
});

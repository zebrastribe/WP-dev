import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertBackupFileExists,
  backupDirFor,
  chownBackupArtifact,
  COMPLETE_BACKUP_TAR_EXCLUDES,
  FULL_BACKUP_TAR_EXCLUDES,
  timestampedCompleteName,
  timestampedDbName,
  timestampedFullName,
  timestampedPreRestoreName,
} from "../src/services/backup.js";
import { listRecentBackups } from "../src/commands/backup.js";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync, rmSync, readFileSync } from "node:fs";
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

  it("timestampedCompleteName uses complete- prefix", () => {
    expect(timestampedCompleteName()).toMatch(
      /^complete-2026-06-17-14-05-\d{2}-\d{3}-[a-z0-9]+\.tar\.gz$/,
    );
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

  it("FULL_BACKUP_TAR_EXCLUDES drops build junk and stale export temps", () => {
    expect(FULL_BACKUP_TAR_EXCLUDES).toContain("node_modules");
    expect(FULL_BACKUP_TAR_EXCLUDES).toContain(".git");
    expect(FULL_BACKUP_TAR_EXCLUDES).toContain(".wp-dev-export-*.sql");
  });

  it("COMPLETE_BACKUP_TAR_EXCLUDES omits secrets and build junk", () => {
    expect(COMPLETE_BACKUP_TAR_EXCLUDES).toContain("wp-config.php");
    expect(COMPLETE_BACKUP_TAR_EXCLUDES).toContain("node_modules");
    expect(COMPLETE_BACKUP_TAR_EXCLUDES).toContain(".wp-dev-export-*.sql");
  });

  it("chownBackupArtifact does not throw on a normal file", () => {
    const dir = mkdtempSync(join(tmpdir(), "wp-dev-backup-chown-"));
    const file = join(dir, "dump.sql");
    writeFileSync(file, "-- sql");
    expect(() => chownBackupArtifact(file)).not.toThrow();
    rmSync(dir, { recursive: true, force: true });
  });

  it("listRecentBackups orders by mtime, not lexical name", () => {
    vi.useRealTimers();
    const project = `mtime-sort-${Date.now()}`;
    const dir = backupDirFor(project, "local");
    mkdirSync(dir, { recursive: true });
    const older = join(dir, "pre-restore-2099-01-01-00-00-00-000-zzz.sql");
    const newer = join(dir, "db-2020-01-01-00-00-00-000-aaa.sql");
    writeFileSync(older, "-- old");
    writeFileSync(newer, "-- new");
    const tOld = Date.now() / 1000 - 120;
    const tNew = Date.now() / 1000 - 10;
    utimesSync(older, tOld, tOld);
    utimesSync(newer, tNew, tNew);
    const recent = listRecentBackups(project, "local", 2);
    expect(recent[0]).toBe(newer);
    expect(recent[1]).toBe(older);
    rmSync(dir, { recursive: true, force: true });
  });

  it("cmdBackup acquires the project sync lock before work", () => {
    const src = readFileSync(join("src/commands/backup.ts"), "utf8");
    const fn = src.indexOf("export async function cmdBackup");
    const body = src.slice(fn, src.indexOf("async function cmdBackupFull"));
    expect(body).toContain("acquireSyncLock(loaded.config.project, `backup:${env}`)");
    expect(body).toContain("releaseSyncLock(syncLock)");
    expect(body.indexOf("acquireSyncLock")).toBeLessThan(body.indexOf("wpLocalDbExportToFile"));
  });
});

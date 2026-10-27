import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildRemoteArchiveRsyncShell,
  remoteExtractDbPath,
  remotePreRestoreDumpPath,
} from "../src/utils/restore-archive-order.js";

describe("restore-archive-order (F-018)", () => {
  it("builds content rsync before any db import semantics", () => {
    const sh = buildRemoteArchiveRsyncShell("content", "/tmp/wpdev-restore-1", "'/var/www/html'");
    expect(sh).toContain("rsync -a --delete");
    expect(sh).toContain("/tmp/wpdev-restore-1/extract/wp-content/");
    expect(sh).toContain("'/var/www/html'/wp-content/");
    expect(sh).not.toContain("db import");
  });

  it("excludes wp-config on complete restore rsync", () => {
    const sh = buildRemoteArchiveRsyncShell("complete", "/tmp/work", "'/var/www'");
    expect(sh).toContain("--exclude=wp-config.php");
    expect(sh).toContain("/tmp/work/extract/site/");
  });

  it("keeps pre.sql under the remote work dir for rollback", () => {
    expect(remotePreRestoreDumpPath("/tmp/wpdev-restore-9")).toBe(
      "/tmp/wpdev-restore-9/pre.sql",
    );
    expect(remoteExtractDbPath("/tmp/wpdev-restore-9")).toBe(
      "/tmp/wpdev-restore-9/extract/db.sql",
    );
  });

  it("cmdRestore source does files rsync before wpRemoteDbImport", () => {
    const src = readFileSync(join("src/commands/restore.ts"), "utf8");
    const rsyncIdx = src.indexOf("rsync archive files (before DB import)");
    const importIdx = src.indexOf("await wpRemoteDbImport(ssh, wpPath, remoteDbSql)");
    expect(rsyncIdx).toBeGreaterThan(0);
    expect(importIdx).toBeGreaterThan(rsyncIdx);
  });

  it("cmdRestore confirms before acquiring the sync lock", () => {
    const src = readFileSync(join("src/commands/restore.ts"), "utf8");
    const confirmIdx = src.indexOf("confirmRemoteTarget");
    const lockIdx = src.indexOf("acquireSyncLock(config.project, `restore:");
    expect(confirmIdx).toBeGreaterThan(0);
    expect(lockIdx).toBeGreaterThan(confirmIdx);
  });

  it("local archive restore uses runLocalWordpressFileMutation envelope", () => {
    const src = readFileSync(join("src/commands/restore.ts"), "utf8");
    const fnStart = src.indexOf("async function restoreLocalArchive");
    const slice = src.slice(fnStart, src.indexOf("async function restoreRemoteArchive"));
    expect(slice).toContain("runLocalWordpressFileMutation");
    expect(slice.indexOf("runLocalWordpressFileMutation")).toBeLessThan(slice.indexOf('rsync"'));
  });

  it("local SQL restore rolls back from pre-restore on import failure", () => {
    const src = readFileSync(join("src/commands/restore.ts"), "utf8");
    const start = src.indexOf("restore local: pre-restore db backup");
    const slice = src.slice(start, src.indexOf("if (isArchive)", start));
    expect(slice).toContain("rolling back DB from ${preRestore}");
    expect(slice).toContain("await wpLocalDbImportFromFile(configDir, config, preRestore)");
  });

  it("local archive DB import failure rolls back from pre-restore", () => {
    const src = readFileSync(join("src/commands/restore.ts"), "utf8");
    const fnStart = src.indexOf("async function restoreLocalArchive");
    const slice = src.slice(fnStart, src.indexOf("async function restoreRemoteArchive"));
    expect(slice).toContain("rolling back from ${preRestore}");
  });
});

import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execa } from "execa";
import type { LoadedConfig } from "../config/load.js";
import { resolveFromConfigDir } from "../config/load.js";
import { getRemoteEnv, type RemoteEnvName } from "../config/schema.js";
import { connectSsh } from "../services/ssh.js";
import { assertRemotePathSafe } from "../services/remote-path-safety.js";
import {
  chownBackupArtifact,
  COMPLETE_BACKUP_TAR_EXCLUDES,
  ensureBackupDir,
  FULL_BACKUP_TAR_EXCLUDES,
  timestampedCompleteName,
  timestampedDbName,
  timestampedFullName,
} from "../services/backup.js";
import {
  assertLocalWpInstalled,
  assertRemoteWpInstalled,
  wpLocalDbExportToFile,
  wpRemoteDbExport,
} from "../services/wpcli.js";
import {
  DISK_NEED,
  assertLocalFreeSpace,
  assertRemoteFreeSpace,
  directorySizeBytes,
  needForFullBackup,
  wrapNoSpaceError,
} from "../utils/disk-space.js";
import { logInfo } from "../utils/logger.js";
import { posixShellQuote, remoteRmFile, remoteRmRf } from "../utils/shell-quote.js";
import { acquireSyncLock, releaseSyncLock } from "@wpdev/sync-engine";

export type BackupTarget = RemoteEnvName | "local";

export type BackupOptions = {
  /** When true, backup wp-content + DB as a .tar.gz (content archive). */
  files?: boolean;
  /** When true, backup entire WordPress tree + DB (update rollback). */
  complete?: boolean;
};

export function listRecentBackups(
  project: string,
  env: BackupTarget,
  limit = 5,
): string[] {
  const dir = ensureBackupDir(project, env);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith(".sql") || n.endsWith(".tar.gz"))
    .map((n) => {
      const path = join(dir, n);
      let mtimeMs = 0;
      try {
        mtimeMs = statSync(path).mtimeMs;
      } catch {
        /* ignore unreadable entries */
      }
      return { path, mtimeMs, name: n };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name))
    .slice(0, limit)
    .map((x) => x.path);
}

export async function cmdBackup(
  loaded: LoadedConfig,
  env: BackupTarget,
  options: BackupOptions = {},
): Promise<void> {
  const syncLock = acquireSyncLock(loaded.config.project, `backup:${env}`);
  try {
    if (options.complete) {
      await cmdBackupComplete(loaded, env);
      return;
    }
    if (options.files) {
      await cmdBackupFull(loaded, env);
      return;
    }

    const { config, configDir } = loaded;
    const dir = ensureBackupDir(config.project, env);
    const name = timestampedDbName();
    const outPath = join(dir, name);

    logInfo(`backup ${env} -> ${outPath}`);
    assertLocalFreeSpace(dir, DISK_NEED.dbBackupLocal, `backup ${env} (database)`);

    if (env === "local") {
      await assertLocalWpInstalled(configDir, config);
      try {
        await wpLocalDbExportToFile(configDir, config, outPath);
      } catch (e) {
        throw wrapNoSpaceError(e, `backup ${env} (database)`);
      }
      chownBackupArtifact(outPath, configDir);
      console.error(`Local database backup written to ${outPath}`);
      return;
    }

    const remote = getRemoteEnv(config, env);
    const ssh = await connectSsh(remote);
    try {
      await assertRemotePathSafe(ssh, remote.path, env);
      await assertRemoteFreeSpace(
        ssh,
        "/tmp",
        DISK_NEED.dbBackupRemoteTmp,
        `backup ${env} (database)`,
      );
      const wpPath = await assertRemoteWpInstalled(ssh, remote.path);
      const remoteDump = `/tmp/wp-dev-backup-${Date.now()}.sql`;
      await wpRemoteDbExport(ssh, wpPath, remoteDump);
      await ssh.getFile(remoteDump, outPath);
      await ssh.exec(remoteRmFile(remoteDump));
    } catch (e) {
      throw wrapNoSpaceError(e, `backup ${env} (database)`);
    } finally {
      ssh.dispose();
    }

    chownBackupArtifact(outPath, configDir);
    console.error(`${env} database backup written to ${outPath}`);
  } finally {
    releaseSyncLock(syncLock);
  }
}

async function cmdBackupFull(
  loaded: LoadedConfig,
  env: BackupTarget,
): Promise<void> {
  const { config, configDir } = loaded;
  const dir = ensureBackupDir(config.project, env);
  const outPath = join(dir, timestampedFullName());

  logInfo(`backup ${env} (full) -> ${outPath}`);

  if (env === "local") {
    await assertLocalWpInstalled(configDir, config);
    const wpRoot = resolveFromConfigDir(configDir, config.local.wpRoot);
    const wpContent = join(wpRoot, "wp-content");
    if (!existsSync(wpContent)) {
      throw new Error(`Missing wp-content directory: ${wpContent}`);
    }
    const need = needForFullBackup(directorySizeBytes(wpContent));
    assertLocalFreeSpace(dir, need, `backup ${env} (full)`);
    assertLocalFreeSpace(tmpdir(), need, `backup ${env} (full) temp`);
    const tmpDir = mkdtempSync(join(tmpdir(), "wp-dev-backup-full-"));
    const dbPath = join(tmpDir, "db.sql");
    try {
      await wpLocalDbExportToFile(configDir, config, dbPath);
      await execa(
        "tar",
        [
          "-czf",
          outPath,
          ...FULL_BACKUP_TAR_EXCLUDES.flatMap((e) => ["--exclude", e]),
          "-C",
          wpRoot,
          "wp-content",
          "-C",
          tmpDir,
          "db.sql",
        ],
        { reject: true },
      );
    } catch (e) {
      throw wrapNoSpaceError(e, `backup ${env} (full)`);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
    chownBackupArtifact(outPath, configDir);
    console.error(`Local full backup (DB + wp-content) written to ${outPath}`);
    return;
  }

  const remote = getRemoteEnv(config, env);
  const ssh = await connectSsh(remote);
  const stamp = Date.now();
  const remoteDir = `/tmp/wp-dev-full-${env}-${stamp}`;
  const remoteTar = `${remoteDir}/full.tar.gz`;
  try {
    await assertRemotePathSafe(ssh, remote.path, env);
    const resolvedPath = await assertRemoteWpInstalled(ssh, remote.path);
    // Remote /tmp must hold the packed archive; local disk must hold the download.
    await assertRemoteFreeSpace(
      ssh,
      "/tmp",
      DISK_NEED.fullBackupFloor,
      `backup ${env} (full)`,
    );
    assertLocalFreeSpace(dir, DISK_NEED.fullBackupFloor, `backup ${env} (full) download`);
    const wpPath = posixShellQuote(resolvedPath);
    const packed = await ssh.exec(
      [
        "set -e",
        `mkdir -p ${remoteDir}`,
        `cd ${wpPath}`,
        `wp db export ${remoteDir}/db.sql --allow-root >/dev/null`,
        `tar -czf ${remoteTar} ${FULL_BACKUP_TAR_EXCLUDES.map((e) => `--exclude=${e}`).join(" ")} -C ${wpPath} wp-content -C ${remoteDir} db.sql`,
      ].join("; "),
    );
    if (packed.code !== 0) {
      throw wrapNoSpaceError(
        new Error(
          `Remote full backup failed (exit ${packed.code}): ${packed.stderr || packed.stdout}`,
        ),
        `backup ${env} (full)`,
      );
    }
    await ssh.getFile(remoteTar, outPath);
    await ssh.exec(remoteRmRf(remoteDir));
  } catch (e) {
    throw wrapNoSpaceError(e, `backup ${env} (full)`);
  } finally {
    ssh.dispose();
  }
  chownBackupArtifact(outPath, configDir);
  console.error(`${env} full backup (DB + wp-content) written to ${outPath}`);
}

async function cmdBackupComplete(
  loaded: LoadedConfig,
  env: BackupTarget,
): Promise<void> {
  const { config, configDir } = loaded;
  const project = config.project;
  const dir = ensureBackupDir(project, env);
  const outPath = join(dir, timestampedCompleteName());
  const excludeArgs = COMPLETE_BACKUP_TAR_EXCLUDES.map((e) => `--exclude=${e}`);

  if (env === "local") {
    await assertLocalWpInstalled(configDir, config);
    const wpRoot = resolveFromConfigDir(configDir, config.local.wpRoot);
    const siteBytes = directorySizeBytes(wpRoot);
    assertLocalFreeSpace(
      dir,
      needForFullBackup(siteBytes),
      "backup local (complete)",
    );
    assertLocalFreeSpace(
      tmpdir(),
      needForFullBackup(siteBytes),
      "backup local (complete) temp",
    );
    const tmp = mkdtempSync(join(tmpdir(), "wpdev-complete-"));
    try {
      const sqlPath = join(tmp, "db.sql");
      const siteStaging = join(tmp, "site");
      await execa("mkdir", ["-p", siteStaging]);
      await wpLocalDbExportToFile(configDir, config, sqlPath);
      // Stage WP tree without secrets / heavy junk, then pack stable layout: db.sql + site/
      await execa(
        "tar",
        [
          "-cf",
          join(tmp, "site.tar"),
          ...COMPLETE_BACKUP_TAR_EXCLUDES.flatMap((e) => ["--exclude", e]),
          "-C",
          wpRoot,
          ".",
        ],
        { reject: true },
      );
      await execa("tar", ["-xf", join(tmp, "site.tar"), "-C", siteStaging], {
        reject: true,
      });
      await execa("tar", ["-czf", outPath, "-C", tmp, "db.sql", "site"], {
        reject: true,
      });
    } catch (e) {
      throw wrapNoSpaceError(e, "backup local (complete)");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    chownBackupArtifact(outPath, configDir);
    console.error(`Local complete backup (DB + WordPress tree) written to ${outPath}`);
    return;
  }

  const remote = getRemoteEnv(config, env);
  logInfo(`Backing up ${env} (complete: DB + WordPress tree)…`);
  const ssh = await connectSsh(remote);
  const remoteDir = `/tmp/wpdev-complete-${Date.now()}`;
  const remoteTar = `${remoteDir}/complete.tar.gz`;
  try {
    await assertRemotePathSafe(ssh, remote.path, env);
    const resolvedPath = await assertRemoteWpInstalled(ssh, remote.path);
    await assertRemoteFreeSpace(
      ssh,
      "/tmp",
      DISK_NEED.fullBackupFloor,
      `backup ${env} (complete)`,
    );
    assertLocalFreeSpace(
      dir,
      DISK_NEED.fullBackupFloor,
      `backup ${env} (complete) download`,
    );
    const wpPath = posixShellQuote(resolvedPath);
    const packed = await ssh.exec(
      [
        "set -e",
        `mkdir -p ${remoteDir}/site`,
        `cd ${wpPath}`,
        `wp db export ${remoteDir}/db.sql --allow-root >/dev/null`,
        `tar -cf ${remoteDir}/site.tar ${excludeArgs.join(" ")} -C ${wpPath} .`,
        `tar -xf ${remoteDir}/site.tar -C ${remoteDir}/site`,
        `tar -czf ${remoteTar} -C ${remoteDir} db.sql site`,
      ].join("; "),
    );
    if (packed.code !== 0) {
      throw wrapNoSpaceError(
        new Error(
          `Remote complete backup failed (exit ${packed.code}): ${packed.stderr || packed.stdout}`,
        ),
        `backup ${env} (complete)`,
      );
    }
    await ssh.getFile(remoteTar, outPath);
    await ssh.exec(remoteRmRf(remoteDir));
  } catch (e) {
    throw wrapNoSpaceError(e, `backup ${env} (complete)`);
  } finally {
    ssh.dispose();
  }
  chownBackupArtifact(outPath, configDir);
  console.error(`${env} complete backup (DB + WordPress tree) written to ${outPath}`);
}

import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execa } from "execa";
import type { LoadedConfig } from "../config/load.js";
import { resolveFromConfigDir } from "../config/load.js";
import { getRemoteEnv, type RemoteEnvName } from "../config/schema.js";
import { connectSsh } from "../services/ssh.js";
import {
  chownBackupArtifact,
  ensureBackupDir,
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

export type BackupTarget = RemoteEnvName | "local";

export type BackupOptions = {
  /** When true, backup wp-content + DB as a .tar.gz. */
  files?: boolean;
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
    .sort()
    .reverse()
    .slice(0, limit)
    .map((n) => join(dir, n));
}

export async function cmdBackup(
  loaded: LoadedConfig,
  env: BackupTarget,
  options: BackupOptions = {},
): Promise<void> {
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
        ["-czf", outPath, "-C", wpRoot, "wp-content", "-C", tmpDir, "db.sql"],
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
        `tar -czf ${remoteTar} -C ${wpPath} wp-content -C ${remoteDir} db.sql`,
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

import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execa } from "execa";
import type { LoadedConfig } from "../config/load.js";
import { resolveFromConfigDir } from "../config/load.js";
import { getRemoteEnv, type RemoteEnvName } from "../config/schema.js";
import { connectSsh } from "../services/ssh.js";
import { ensureBackupDir, timestampedDbName, timestampedFullName } from "../services/backup.js";
import {
  assertLocalWpInstalled,
  assertRemoteWpInstalled,
  wpLocalDbExportToFile,
  wpRemoteDbExport,
} from "../services/wpcli.js";
import { logInfo } from "../utils/logger.js";

export type BackupTarget = RemoteEnvName | "local";

export type BackupOptions = {
  /** When true, backup wp-content + DB as a .tar.gz. */
  files?: boolean;
};

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

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

  if (env === "local") {
    await assertLocalWpInstalled(configDir, config);
    await wpLocalDbExportToFile(configDir, config, outPath);
    console.error(`Local database backup written to ${outPath}`);
    return;
  }

  const remote = getRemoteEnv(config, env);
  const ssh = await connectSsh(remote);
  try {
    await assertRemoteWpInstalled(ssh, remote.path);
    const remoteDump = `/tmp/wp-dev-backup-${Date.now()}.sql`;
    await wpRemoteDbExport(ssh, remote.path, remoteDump);
    await ssh.getFile(remoteDump, outPath);
    await ssh.exec(`rm -f ${remoteDump}`);
  } finally {
    ssh.dispose();
  }

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
    const tmpDir = mkdtempSync(join(tmpdir(), "wp-dev-backup-full-"));
    const dbPath = join(tmpDir, "db.sql");
    try {
      await wpLocalDbExportToFile(configDir, config, dbPath);
      await execa(
        "tar",
        ["-czf", outPath, "-C", wpRoot, "wp-content", "-C", tmpDir, "db.sql"],
        { reject: true },
      );
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
    console.error(`Local full backup (DB + wp-content) written to ${outPath}`);
    return;
  }

  const remote = getRemoteEnv(config, env);
  const ssh = await connectSsh(remote);
  const stamp = Date.now();
  const remoteDir = `/tmp/wp-dev-full-${env}-${stamp}`;
  const remoteTar = `${remoteDir}/full.tar.gz`;
  const wpPath = shellQuote(remote.path);
  try {
    await assertRemoteWpInstalled(ssh, remote.path);
    await ssh.exec(
      [
        "set -e",
        `mkdir -p ${remoteDir}`,
        `cd ${wpPath}`,
        `wp db export ${remoteDir}/db.sql --allow-root >/dev/null`,
        `tar -czf ${remoteTar} -C ${wpPath} wp-content -C ${remoteDir} db.sql`,
      ].join("; "),
    );
    await ssh.getFile(remoteTar, outPath);
    await ssh.exec(`rm -rf ${remoteDir}`);
  } finally {
    ssh.dispose();
  }
  console.error(`${env} full backup (DB + wp-content) written to ${outPath}`);
}

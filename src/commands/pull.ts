import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { LoadedConfig } from "../config/load.js";
import { resolveFromConfigDir } from "../config/load.js";
import { getRemoteEnv, type RemoteEnvName } from "../config/schema.js";
import { connectSsh } from "../services/ssh.js";
import { rsyncPull } from "../services/rsync.js";
import { ensureBackupDir, timestampedDbName } from "../services/backup.js";
import {
  assertRemoteWpInstalled,
  isLocalWpInstalled,
  wpLocalDbExportToFile,
  wpLocalDbImportFromFile,
  wpLocalSearchReplace,
  wpRemoteDbExport,
} from "../services/wpcli.js";
import { logInfo } from "../utils/logger.js";
import { detectTablePrefixFromSqlDump } from "../utils/sql-dump-prefix.js";

export type PullOptions = {
  dryRun: boolean;
  /** When true (default), export local DB before rsync/import if WordPress is installed locally. */
  backupLocal: boolean;
};

export async function cmdPull(
  loaded: LoadedConfig,
  env: RemoteEnvName,
  options: PullOptions,
): Promise<void> {
  const { config, configDir } = loaded;
  const remote = getRemoteEnv(config, env);
  const localWpRoot = resolveFromConfigDir(configDir, config.local.wpRoot);

  if (options.dryRun) {
    logInfo(`pull ${env} dry-run: rsync only`);
    console.error("[dry-run] Would: validate SSH, export remote DB, rsync files, import DB, search-replace URLs.");
    await rsyncPull(remote, localWpRoot, { dryRun: true });
    return;
  }

  let prePullBackup: string | undefined;
  if (options.backupLocal) {
    if (await isLocalWpInstalled(configDir, config)) {
      const backupDir = ensureBackupDir(config.project, "local");
      prePullBackup = join(backupDir, `pre-pull-${timestampedDbName()}`);
      logInfo(`pull ${env}: local pre-pull db backup -> ${prePullBackup}`);
      await wpLocalDbExportToFile(configDir, config, prePullBackup);
    } else {
      logInfo(
        `pull ${env}: skip local pre-pull backup (local WordPress not installed yet — first pull)`,
      );
    }
  }

  logInfo(`pull ${env}: connect ssh ${remote.user}@${remote.host}`);
  const ssh = await connectSsh(remote);
  try {
    await assertRemoteWpInstalled(ssh, remote.path);

    const remoteDump = `/tmp/wp-dev-pull-${Date.now()}.sql`;
    logInfo(`pull ${env}: remote wp db export`);
    await wpRemoteDbExport(ssh, remote.path, remoteDump);

    const tmpDir = mkdtempSync(join(tmpdir(), "wp-dev-pull-"));
    const localDump = join(tmpDir, "dump.sql");
    try {
      await ssh.getFile(remoteDump, localDump);
      await ssh.exec(`rm -f ${remoteDump.replace(/'/g, `'\\''`)}`);

      logInfo(`pull ${env}: rsync files -> ${localWpRoot}`);
      await rsyncPull(remote, localWpRoot, { dryRun: false });

      const sql = readFileSync(localDump, "utf8");
      if (!/CREATE TABLE|INSERT INTO/i.test(sql)) {
        throw new Error("Downloaded SQL dump looks empty or invalid.");
      }

      logInfo(`pull ${env}: local wp db import`);
      await wpLocalDbImportFromFile(configDir, config, localDump);
      logInfo(`pull ${env}: search-replace ${remote.url} -> ${config.local.url}`);
      await wpLocalSearchReplace(configDir, config, remote.url, config.local.url);

      const tablePrefix = detectTablePrefixFromSqlDump(sql);
      if (tablePrefix && tablePrefix !== "wp_") {
        console.error(
          `\nRemote DB uses table prefix "${tablePrefix}". Set WORDPRESS_TABLE_PREFIX=${tablePrefix} in docker/.env (see docker/.env.example), then run wp-dev down && wp-dev up. Pull does not sync wp-config.php.\n`,
        );
      }
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  } finally {
    ssh.dispose();
  }

  const backupNote =
    prePullBackup !== undefined
      ? ` Local pre-pull DB backup: ${prePullBackup}`
      : "";
  console.error(
    `Pull from ${env} complete. Database and files synced; URLs replaced ${remote.url} -> ${config.local.url}.${backupNote}`,
  );
}

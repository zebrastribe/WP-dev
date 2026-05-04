import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { LoadedConfig } from "../config/load.js";
import { resolveFromConfigDir } from "../config/load.js";
import { getRemoteEnv, type RemoteEnvName } from "../config/schema.js";
import { connectSsh } from "../services/ssh.js";
import { rsyncPush } from "../services/rsync.js";
import {
  assertLocalWpInstalled,
  assertRemoteWpInstalled,
  checkRemoteWpInstalled,
  wpLocalDbExportToFile,
  wpRemoteDbExport,
  wpRemoteDbImport,
  wpRemoteSearchReplace,
} from "../services/wpcli.js";
import { ensureBackupDir, timestampedDbName } from "../services/backup.js";
import { confirmProduction } from "../utils/confirm.js";
import { logInfo } from "../utils/logger.js";

export type PushOptions = {
  dryRun: boolean;
};

export async function cmdPush(
  loaded: LoadedConfig,
  env: RemoteEnvName,
  options: PushOptions,
): Promise<void> {
  const { config, configDir } = loaded;
  const remote = getRemoteEnv(config, env);
  const localWpRoot = resolveFromConfigDir(configDir, config.local.wpRoot);

  if (env === "production" && !options.dryRun) {
    const ok = await confirmProduction(
      "You are about to push the local database and files to PRODUCTION.",
    );
    if (!ok) {
      logInfo("push production: user aborted at confirmation");
      console.error("Aborted.");
      process.exitCode = 1;
      return;
    }
  }

  if (options.dryRun) {
    logInfo(`push ${env} dry-run: rsync only`);
    console.error(
      "[dry-run] Would: backup remote DB, rsync push, export local DB, import on remote, search-replace URLs.",
    );
    await rsyncPush(remote, localWpRoot, { dryRun: true });
    return;
  }

  await assertLocalWpInstalled(configDir, config);

  logInfo(`push ${env}: connect ssh ${remote.user}@${remote.host}`);
  const ssh = await connectSsh(remote);
  let prePushBackup = "";
  try {
    const remoteWp = await checkRemoteWpInstalled(ssh, remote.path);
    const shouldBootstrapStaging = env === "staging" && !remoteWp.installed;
    if (!remoteWp.installed && !shouldBootstrapStaging) {
      await assertRemoteWpInstalled(ssh, remote.path);
    }
    if (shouldBootstrapStaging) {
      logInfo(`push ${env}: remote WP not installed yet — bootstrap files only`);
      await rsyncPush(remote, localWpRoot, { dryRun: false });
      console.error(
        `Seeded files to ${env}, but remote WordPress is not installed at ${remote.path} yet.\n` +
          `Next: open ${remote.url}/wp-admin/install.php (or finish host installer), then run:\n` +
          `  npm run wp-dev -- push ${env}\n` +
          `to sync database and run URL search-replace.`,
      );
      return;
    }

    const backupDir = ensureBackupDir(config.project, env);
    const preName = timestampedDbName();
    prePushBackup = join(backupDir, `pre-push-${preName}`);
    const remotePreDump = `/tmp/wp-dev-pre-push-${Date.now()}.sql`;
    logInfo(`push ${env}: remote pre-push db backup -> ${prePushBackup}`);
    await wpRemoteDbExport(ssh, remote.path, remotePreDump);
    await ssh.getFile(remotePreDump, prePushBackup);
    await ssh.exec(`rm -f ${remotePreDump}`);

    logInfo(`push ${env}: rsync files -> remote`);
    await rsyncPush(remote, localWpRoot, { dryRun: false });

    const tmpDir = mkdtempSync(join(tmpdir(), "wp-dev-push-"));
    const localDump = join(tmpDir, "local.sql");
    const remoteImport = `/tmp/wp-dev-push-import-${Date.now()}.sql`;
    try {
      logInfo(`push ${env}: export local db, import on remote`);
      await wpLocalDbExportToFile(configDir, config, localDump);
      await ssh.putFile(localDump, remoteImport);
      await wpRemoteDbImport(ssh, remote.path, remoteImport);
      await ssh.exec(`rm -f ${remoteImport}`);
      logInfo(`push ${env}: search-replace ${config.local.url} -> ${remote.url}`);
      await wpRemoteSearchReplace(ssh, remote.path, config.local.url, remote.url);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  } finally {
    ssh.dispose();
  }

  console.error(`Push to ${env} complete. Remote pre-push DB backup: ${prePushBackup}`);
}

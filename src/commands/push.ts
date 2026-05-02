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
  wpLocalDbExportToFile,
  wpRemoteDbExport,
  wpRemoteDbImport,
  wpRemoteSearchReplace,
} from "../services/wpcli.js";
import { ensureBackupDir, timestampedDbName } from "../services/backup.js";
import { confirmProduction } from "../utils/confirm.js";

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
      console.error("Aborted.");
      process.exitCode = 1;
      return;
    }
  }

  if (options.dryRun) {
    console.error(
      "[dry-run] Would: backup remote DB, rsync push, export local DB, import on remote, search-replace URLs.",
    );
    await rsyncPush(remote, localWpRoot, { dryRun: true });
    return;
  }

  await assertLocalWpInstalled(configDir, config);

  const ssh = await connectSsh(remote);
  let prePushBackup = "";
  try {
    await assertRemoteWpInstalled(ssh, remote.path);

    const backupDir = ensureBackupDir(config.project, env);
    const preName = timestampedDbName();
    prePushBackup = join(backupDir, `pre-push-${preName}`);
    const remotePreDump = `/tmp/wpflow-pre-push-${Date.now()}.sql`;
    await wpRemoteDbExport(ssh, remote.path, remotePreDump);
    await ssh.getFile(remotePreDump, prePushBackup);
    await ssh.exec(`rm -f ${remotePreDump}`);

    await rsyncPush(remote, localWpRoot, { dryRun: false });

    const tmpDir = mkdtempSync(join(tmpdir(), "wpflow-push-"));
    const localDump = join(tmpDir, "local.sql");
    const remoteImport = `/tmp/wpflow-push-import-${Date.now()}.sql`;
    try {
      await wpLocalDbExportToFile(configDir, config, localDump);
      await ssh.putFile(localDump, remoteImport);
      await wpRemoteDbImport(ssh, remote.path, remoteImport);
      await ssh.exec(`rm -f ${remoteImport}`);
      await wpRemoteSearchReplace(ssh, remote.path, config.local.url, remote.url);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  } finally {
    ssh.dispose();
  }

  console.error(`Push to ${env} complete. Remote pre-push DB backup: ${prePushBackup}`);
}

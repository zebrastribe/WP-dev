import { join } from "node:path";
import type { LoadedConfig } from "../config/load.js";
import { getRemoteEnv, type RemoteEnvName } from "../config/schema.js";
import {
  chownBackupArtifact,
  ensureBackupDir,
  timestampedPreRestoreName,
} from "../services/backup.js";
import { assertRestoreBackupPath } from "../utils/restore-path.js";
import { connectSsh } from "../services/ssh.js";
import {
  assertLocalWpInstalled,
  assertRemoteWpInstalled,
  wpLocalDbExportToFile,
  wpLocalDbImportFromFile,
  wpRemoteDbExport,
  wpRemoteDbImport,
} from "../services/wpcli.js";
import { confirmRemoteTarget } from "../utils/confirm.js";
import { acquireSyncLock, releaseSyncLock } from "../utils/sync-lock.js";
import { logInfo } from "../utils/logger.js";
import { remoteRmFile } from "../utils/shell-quote.js";

export type RestoreTarget = RemoteEnvName | "local";

export type RestoreOptions = {
  yes?: boolean;
  /** Required with --yes for staging: must equal staging.host */
  confirmHost?: string;
};

export async function cmdRestore(
  loaded: LoadedConfig,
  env: RestoreTarget,
  file: string,
  opts: RestoreOptions = {},
): Promise<void> {
  const { config, configDir } = loaded;
  const resolvedFile = assertRestoreBackupPath(config.project, env, file);

  logInfo(`restore ${env} from ${resolvedFile}`);
  const syncLock = acquireSyncLock(config.project, `restore:${env}`);
  try {
    if (env !== "local") {
      const remote = getRemoteEnv(config, env);
      const ok = await confirmRemoteTarget(env, remote, "restore", {
        yes: Boolean(opts.yes),
        confirmHost: opts.confirmHost,
      });
      if (!ok) {
        logInfo(`restore ${env}: user aborted at confirmation`);
        console.error("Aborted.");
        process.exitCode = 1;
        return;
      }
    }

    if (env === "local") {
      await assertLocalWpInstalled(configDir, config);
      const backupDir = ensureBackupDir(config.project, "local");
      const preRestore = join(backupDir, timestampedPreRestoreName());
      logInfo(`restore local: pre-restore db backup -> ${preRestore}`);
      await wpLocalDbExportToFile(configDir, config, preRestore);
      chownBackupArtifact(preRestore, configDir);
      await wpLocalDbImportFromFile(configDir, config, resolvedFile);
      console.error(`Local database restored from backup. Pre-restore DB backup: ${preRestore}`);
      return;
    }

    const remote = getRemoteEnv(config, env);
    const ssh = await connectSsh(remote);
    const remoteImport = `/tmp/wp-dev-restore-${Date.now()}.sql`;
    const backupDir = ensureBackupDir(config.project, env);
    const preRestoreLocal = join(backupDir, timestampedPreRestoreName());
    try {
      const wpPath = await assertRemoteWpInstalled(ssh, remote.path);
      logInfo(`restore ${env}: pre-restore remote db backup -> ${preRestoreLocal}`);
      const remotePreDump = `/tmp/wp-dev-pre-restore-${Date.now()}.sql`;
      await wpRemoteDbExport(ssh, wpPath, remotePreDump);
      await ssh.getFile(remotePreDump, preRestoreLocal);
      chownBackupArtifact(preRestoreLocal, configDir);
      await ssh.exec(remoteRmFile(remotePreDump));

      await ssh.putFile(resolvedFile, remoteImport);
      await wpRemoteDbImport(ssh, wpPath, remoteImport);
      await ssh.exec(remoteRmFile(remoteImport));
    } finally {
      ssh.dispose();
    }

    console.error(
      `${env} database restored from ${resolvedFile}. Pre-restore DB backup: ${preRestoreLocal}`,
    );
  } finally {
    releaseSyncLock(syncLock);
  }
}

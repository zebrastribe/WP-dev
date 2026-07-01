import { join, resolve } from "node:path";
import type { LoadedConfig } from "../config/load.js";
import { getRemoteEnv, type RemoteEnvName } from "../config/schema.js";
import { assertBackupFileExists, ensureBackupDir, timestampedPreRestoreName } from "../services/backup.js";
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
import { logInfo } from "../utils/logger.js";
import { remoteRmFile } from "../utils/shell-quote.js";

export type RestoreTarget = RemoteEnvName | "local";

export type RestoreOptions = {
  yes?: boolean;
};

export async function cmdRestore(
  loaded: LoadedConfig,
  env: RestoreTarget,
  file: string,
  opts: RestoreOptions = {},
): Promise<void> {
  const { config, configDir } = loaded;
  assertBackupFileExists(file);
  const resolvedFile = resolve(file);

  logInfo(`restore ${env} from ${resolvedFile}`);

  if (env !== "local") {
    const remote = getRemoteEnv(config, env);
    const ok = opts.yes
      ? true
      : await confirmRemoteTarget(env, remote, "restore");
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
    await wpLocalDbImportFromFile(configDir, config, resolvedFile);
    console.error(
      `Local database restored from backup. Pre-restore DB backup: ${preRestore}`,
    );
    return;
  }

  const remote = getRemoteEnv(config, env);
  const ssh = await connectSsh(remote);
  const remoteImport = `/tmp/wp-dev-restore-${Date.now()}.sql`;
  const backupDir = ensureBackupDir(config.project, env);
  const preRestoreLocal = join(backupDir, timestampedPreRestoreName());
  try {
    await assertRemoteWpInstalled(ssh, remote.path);
    logInfo(`restore ${env}: pre-restore remote db backup -> ${preRestoreLocal}`);
    const remotePreDump = `/tmp/wp-dev-pre-restore-${Date.now()}.sql`;
    await wpRemoteDbExport(ssh, remote.path, remotePreDump);
    await ssh.getFile(remotePreDump, preRestoreLocal);
    await ssh.exec(remoteRmFile(remotePreDump));

    await ssh.putFile(resolvedFile, remoteImport);
    await wpRemoteDbImport(ssh, remote.path, remoteImport);
    await ssh.exec(remoteRmFile(remoteImport));
  } finally {
    ssh.dispose();
  }

  console.error(
    `${env} database restored from ${resolvedFile}. Pre-restore DB backup: ${preRestoreLocal}`,
  );
}

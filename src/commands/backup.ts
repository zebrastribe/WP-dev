import { join } from "node:path";
import type { LoadedConfig } from "../config/load.js";
import { getRemoteEnv, type RemoteEnvName } from "../config/schema.js";
import { connectSsh } from "../services/ssh.js";
import { ensureBackupDir, timestampedDbName } from "../services/backup.js";
import {
  assertLocalWpInstalled,
  assertRemoteWpInstalled,
  wpLocalDbExportToFile,
  wpRemoteDbExport,
} from "../services/wpcli.js";
import { logInfo } from "../utils/logger.js";

export type BackupTarget = RemoteEnvName | "local";

export async function cmdBackup(
  loaded: LoadedConfig,
  env: BackupTarget,
): Promise<void> {
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
    const remoteDump = `/tmp/wpflow-backup-${Date.now()}.sql`;
    await wpRemoteDbExport(ssh, remote.path, remoteDump);
    await ssh.getFile(remoteDump, outPath);
    await ssh.exec(`rm -f ${remoteDump}`);
  } finally {
    ssh.dispose();
  }

  console.error(`${env} database backup written to ${outPath}`);
}

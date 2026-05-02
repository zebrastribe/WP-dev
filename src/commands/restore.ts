import { resolve } from "node:path";
import type { LoadedConfig } from "../config/load.js";
import { getRemoteEnv, type RemoteEnvName } from "../config/schema.js";
import { assertBackupFileExists } from "../services/backup.js";
import { connectSsh } from "../services/ssh.js";
import {
  assertLocalWpInstalled,
  assertRemoteWpInstalled,
  wpLocalDbImportFromFile,
  wpRemoteDbImport,
} from "../services/wpcli.js";
import { confirmProduction } from "../utils/confirm.js";
import { logInfo } from "../utils/logger.js";

export type RestoreTarget = RemoteEnvName | "local";

export async function cmdRestore(
  loaded: LoadedConfig,
  env: RestoreTarget,
  file: string,
): Promise<void> {
  const { config, configDir } = loaded;
  assertBackupFileExists(file);

  logInfo(`restore ${env} from ${resolve(file)}`);

  if (env === "local") {
    await assertLocalWpInstalled(configDir, config);
    await wpLocalDbImportFromFile(configDir, config, file);
    console.error("Local database restored from backup.");
    return;
  }

  if (env === "production") {
    const ok = await confirmProduction(
      "You are about to REPLACE the PRODUCTION database from a backup file.",
    );
    if (!ok) {
      logInfo("restore production: user aborted at confirmation");
      console.error("Aborted.");
      process.exitCode = 1;
      return;
    }
  }

  const remote = getRemoteEnv(config, env);
  const ssh = await connectSsh(remote);
  const remoteImport = `/tmp/wp-dev-restore-${Date.now()}.sql`;
  try {
    await assertRemoteWpInstalled(ssh, remote.path);
    await ssh.putFile(resolve(file), remoteImport);
    await wpRemoteDbImport(ssh, remote.path, remoteImport);
    await ssh.exec(`rm -f ${remoteImport}`);
  } finally {
    ssh.dispose();
  }

  console.error(`${env} database restored from ${file}`);
}

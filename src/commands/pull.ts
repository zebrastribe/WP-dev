import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { LoadedConfig } from "../config/load.js";
import { resolveFromConfigDir } from "../config/load.js";
import { getRemoteEnv, type RemoteEnvName } from "../config/schema.js";
import { connectSsh } from "../services/ssh.js";
import { rsyncPull } from "../services/rsync.js";
import {
  assertRemoteWpInstalled,
  wpLocalDbImportFromFile,
  wpLocalSearchReplace,
  wpRemoteDbExport,
} from "../services/wpcli.js";
import { logInfo } from "../utils/logger.js";

export type PullOptions = {
  dryRun: boolean;
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
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  } finally {
    ssh.dispose();
  }

  console.error(`Pull from ${env} complete. Database and files synced; URLs replaced ${remote.url} -> ${config.local.url}`);
}

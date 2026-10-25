import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { LoadedConfig } from "../config/load.js";
import { resolveFromConfigDir } from "../config/load.js";
import { getRemoteEnv, type RemoteEnvName } from "../config/schema.js";
import { connectSsh } from "../services/ssh.js";
import { assertRemotePathSafe } from "../services/remote-path-safety.js";
import { rsyncPull } from "../services/rsync.js";
import {
  chownBackupArtifact,
  ensureBackupDir,
  timestampedDbName,
} from "../services/backup.js";
import {
  assertRemoteWpInstalled,
  assertNotInTerminalContainerWithoutDocker,
  isLocalWpInstalled,
  wpLocalAlignTablePrefixAfterImport,
  wpLocalDbExportToFile,
  wpLocalDbImportFromFile,
  wpLocalForceSiteUrls,
  wpLocalSearchReplace,
  wpRemoteDbExport,
} from "../services/wpcli.js";
import {
  DISK_NEED,
  assertLocalFreeSpace,
  assertRemoteFreeSpace,
} from "../utils/disk-space.js";
import { logInfo } from "../utils/logger.js";
import { assertValidSqlDump } from "../utils/sql-dump-validate.js";
import { remoteRmFile } from "../utils/shell-quote.js";
import { detectTablePrefixFromSqlDump } from "../utils/sql-dump-prefix.js";
import { cmdFixPermissions } from "./fix-permissions.js";
import {
  reconcileContainerRuntime,
  reconcileHostEditable,
  reconcileSharedConfig,
} from "../fs/index.js";
import { registerTempDir, unregisterTempDir } from "../fs/temp-registry.js";
import { cmdSimplySetupStagingDns } from "./simply.js";
import { getSimplyApiKey } from "../services/simply.js";
import { isStagingRemotePlaceholder } from "../utils/remote-placeholder.js";
import { getUrlVariants } from "../utils/url-variants.js";
import { getLocalUrlPortMismatch } from "../utils/published-local-urls.js";
import { verifyLocalSiteUrls } from "../utils/sync-verify.js";
import { pullExcludePatterns } from "../services/sync-excludes.js";
import { assertHostSyncTools } from "../utils/host-prereq.js";
import { confirmRemoteTarget } from "../utils/confirm.js";
import { acquireSyncLock, releaseSyncLock } from "../utils/sync-lock.js";

export type PullOptions = {
  dryRun: boolean;
  /** When true (default), export local DB before rsync/import if WordPress is installed locally. */
  backupLocal: boolean;
  /** When true, skip auto simply setup-staging-dns after pull production. Default false. */
  skipSimplyStagingDns?: boolean;
  /** Skip interactive SSH-host / production confirmation (browser runner, CI). */
  yes?: boolean;
  /** Required with --yes for staging: must equal staging.host */
  confirmHost?: string;
};

export async function cmdPull(
  loaded: LoadedConfig,
  env: RemoteEnvName,
  options: PullOptions,
): Promise<void> {
  const { config, configDir } = loaded;
  const remote = getRemoteEnv(config, env);
  const localWpRoot = resolveFromConfigDir(configDir, config.local.wpRoot);
  const portMismatch = getLocalUrlPortMismatch(loaded);

  if (portMismatch && !options.dryRun) {
    throw new Error(
      `Refusing to pull: local.url uses port ${portMismatch.localUrlPort}, but docker/.env has WP_PORT=${portMismatch.wpPort}. ` +
        `Update local.url in wp-dev.config.json to http://localhost:${portMismatch.wpPort} (or match your host), then run pull again.`,
    );
  }

  if (!options.dryRun) {
    const ok = await confirmRemoteTarget(env, remote, "pull", {
      yes: Boolean(options.yes) || process.env.WPDEV_ASSUME_YES === "1",
      confirmHost: options.confirmHost,
    });
    if (!ok) {
      logInfo(`pull ${env}: user aborted at confirmation`);
      console.error("Aborted.");
      process.exitCode = 1;
      return;
    }
  }

  if (options.dryRun) {
    logInfo(`pull ${env} dry-run: rsync only`);
    console.error("[dry-run] Would: validate SSH, export remote DB, rsync files, import DB, search-replace URLs.");
    const sshDry = await connectSsh(remote);
    try {
      await assertRemotePathSafe(sshDry, remote.path, env);
    } finally {
      sshDry.dispose();
    }
    await rsyncPull(remote, localWpRoot, {
      dryRun: true,
      excludes: pullExcludePatterns(configDir, config),
    });
    return;
  }

  assertHostSyncTools();
  assertNotInTerminalContainerWithoutDocker();

  const syncLock = acquireSyncLock(config.project, `pull:${env}`);
  try {
  let prePullBackup: string | undefined;
  if (options.backupLocal) {
    if (await isLocalWpInstalled(configDir, config)) {
      const backupDir = ensureBackupDir(config.project, "local");
      prePullBackup = join(backupDir, `pre-pull-${timestampedDbName()}`);
      logInfo(`pull ${env}: local pre-pull db backup -> ${prePullBackup}`);
      await wpLocalDbExportToFile(configDir, config, prePullBackup);
      chownBackupArtifact(prePullBackup, configDir);
    } else {
      logInfo(
        `pull ${env}: skip local pre-pull backup (local WordPress not installed yet — first pull)`,
      );
    }
  }

  logInfo(`pull ${env}: connect ssh ${remote.user}@${remote.host}`);
  const ssh = await connectSsh(remote);
  try {
    await assertRemotePathSafe(ssh, remote.path, env);
    assertLocalFreeSpace(tmpdir(), DISK_NEED.dbBackupLocal, `pull ${env}`);
    await assertRemoteFreeSpace(ssh, "/tmp", DISK_NEED.dbBackupRemoteTmp, `pull ${env}`);
    const wpPath = await assertRemoteWpInstalled(ssh, remote.path);
    if (wpPath !== remote.path) {
      logInfo(`pull ${env}: using remote wp path ${wpPath} (configured: ${remote.path})`);
    }

    const remoteDump = `/tmp/wp-dev-pull-${Date.now()}.sql`;
    logInfo(`pull ${env}: remote wp db export`);
    await wpRemoteDbExport(ssh, wpPath, remoteDump);

    const tmpDir = mkdtempSync(join(tmpdir(), "wp-dev-pull-"));
    const tempId = registerTempDir(loaded, tmpDir, `pull-${env}`);
    const localDump = join(tmpDir, "dump.sql");
    try {
      await ssh.getFile(remoteDump, localDump);
      await ssh.exec(remoteRmFile(remoteDump));

      logInfo(`pull ${env}: rsync files -> ${localWpRoot}`);
      try {
        await reconcileHostEditable(loaded);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(
          `pull ${env}: filesystem reconcile failed (${msg}). Run: npm run wp-dev -- doctor --filesystem`,
        );
      }
      try {
        await rsyncPull(remote, localWpRoot, {
          dryRun: false,
          excludes: pullExcludePatterns(configDir, config),
          remotePath: wpPath,
        });

        const sql = readFileSync(localDump, "utf8");
        assertValidSqlDump(sql, "Downloaded SQL dump");
        const tablePrefix = detectTablePrefixFromSqlDump(sql);

        logInfo(`pull ${env}: local wp db import`);
        await wpLocalDbImportFromFile(configDir, config, localDump);
        if (tablePrefix) {
          logInfo(
            `pull ${env}: align local table prefix to "${tablePrefix}" (docker/.env + wp-config.php)`,
          );
          await wpLocalAlignTablePrefixAfterImport(configDir, config, tablePrefix);
        }
        const fromCandidates = getUrlVariants(remote.url).filter(
          (candidate) => candidate !== config.local.url,
        );
        for (const fromUrl of fromCandidates) {
          logInfo(`pull ${env}: search-replace ${fromUrl} -> ${config.local.url}`);
          await wpLocalSearchReplace(configDir, config, fromUrl, config.local.url);
        }
        logInfo(`pull ${env}: force option home/siteurl -> ${config.local.url}`);
        await wpLocalForceSiteUrls(configDir, config, config.local.url);

        const urlCheck = await verifyLocalSiteUrls(configDir, config, config.local.url);
        if (!urlCheck.ok) {
          throw new Error(
            `Post-sync URL verification failed: home=${urlCheck.home ?? "?"} siteurl=${urlCheck.siteurl ?? "?"} expected=${urlCheck.expected}`,
          );
        }
      } catch (syncErr) {
        if (prePullBackup) {
          logInfo(`pull ${env}: sync failed — rolling back local DB from ${prePullBackup}`);
          try {
            await wpLocalDbImportFromFile(configDir, config, prePullBackup);
            console.error(
              `Rolled back local DB from pre-pull backup: ${prePullBackup}\n` +
                "Files may still differ from before pull — re-run pull or restore from a full backup.",
            );
          } catch (rollbackErr) {
            const rb = rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr);
            console.error(
              `Warning: could not roll back local DB (${rb}). Pre-pull backup kept at: ${prePullBackup}`,
            );
          }
        }
        throw syncErr;
      }
      try {
        // Container rsync runs as root on the bind mount; --no-owner only skips remote uids.
        // Re-own wordpress/ to the host user, then restore www-data write on runtime paths.
        logInfo(`pull ${env}: fix-permissions after rsync (host-own tree + runtime www-data writes)`);
        await reconcileContainerRuntime(loaded);
        await reconcileSharedConfig(loaded);
        await cmdFixPermissions(loaded, { quiet: true });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logInfo(`pull ${env}: fix-permissions step failed (${msg})`);
        console.error(
          "Warning: could not restore wordpress/ ownership after pull. Host edits may need sudo until you run: npm run wp-dev -- fix-permissions",
        );
      }
    } finally {
      unregisterTempDir(loaded.configDir, tempId);
      rmSync(tmpDir, { recursive: true, force: true });
    }
  } finally {
    ssh.dispose();
  }

  if (
    env === "production" &&
    !(options.skipSimplyStagingDns ?? false) &&
    config.simply?.account &&
    isStagingRemotePlaceholder(config) &&
    getSimplyApiKey()
  ) {
    logInfo(
      `pull ${env}: staging still placeholder — running simply setup-staging-dns (apex from production.url)`,
    );
    try {
      await cmdSimplySetupStagingDns(loaded, undefined, {});
      console.error(
        "Simply: staging DNS + wp-dev.config.json staging hints updated. DNS may take a few minutes to propagate.",
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(
        `Simply staging setup did not complete (${msg}). Fix API/DNS conflict, then run: npm run wp-dev -- simply setup-staging-dns`,
      );
    }
  }

  const backupNote =
    prePullBackup !== undefined
      ? ` Local pre-pull DB backup: ${prePullBackup}`
      : "";
  console.error(
    `Pull from ${env} complete. Database and files synced; URLs replaced ${remote.url} -> ${config.local.url}.${backupNote}`,
  );
  } finally {
    releaseSyncLock(syncLock);
  }
}

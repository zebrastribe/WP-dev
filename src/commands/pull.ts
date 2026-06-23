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
  wpLocalAlignTablePrefixAfterImport,
  wpLocalDbExportToFile,
  wpLocalDbImportFromFile,
  wpLocalForceSiteUrls,
  wpLocalSearchReplace,
  wpRemoteDbExport,
} from "../services/wpcli.js";
import { logInfo } from "../utils/logger.js";
import { detectTablePrefixFromSqlDump } from "../utils/sql-dump-prefix.js";
import { cmdFixRuntimeWritePermissions } from "./fix-permissions.js";
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
import { pushExcludePatterns, pullExcludePatterns } from "../services/sync-excludes.js";
import { assertHostSyncTools } from "../utils/host-prereq.js";

export type PullOptions = {
  dryRun: boolean;
  /** When true (default), export local DB before rsync/import if WordPress is installed locally. */
  backupLocal: boolean;
  /** When true, skip auto simply setup-staging-dns after pull production. Default false. */
  skipSimplyStagingDns?: boolean;
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

  if (options.dryRun) {
    logInfo(`pull ${env} dry-run: rsync only`);
    console.error("[dry-run] Would: validate SSH, export remote DB, rsync files, import DB, search-replace URLs.");
    await rsyncPull(remote, localWpRoot, {
      dryRun: true,
      excludes: pullExcludePatterns(configDir, config),
    });
    return;
  }

  assertHostSyncTools();

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
    const tempId = registerTempDir(loaded, tmpDir, `pull-${env}`);
    const localDump = join(tmpDir, "dump.sql");
    try {
      await ssh.getFile(remoteDump, localDump);
      await ssh.exec(`rm -f ${remoteDump.replace(/'/g, `'\\''`)}`);

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
        });

        const sql = readFileSync(localDump, "utf8");
        if (!/CREATE TABLE|INSERT INTO/i.test(sql)) {
          throw new Error("Downloaded SQL dump looks empty or invalid.");
        }
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
        logInfo(`pull ${env}: restore runtime write permissions for wp-content`);
        await reconcileContainerRuntime(loaded);
        await reconcileSharedConfig(loaded);
        await cmdFixRuntimeWritePermissions(loaded, { quiet: true });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logInfo(`pull ${env}: runtime write permissions step failed (${msg})`);
        console.error(
          "Warning: wp-content runtime write permissions could not be applied. If plugin updates fail, run: npm run wp-dev -- fix-runtime-permissions",
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
}

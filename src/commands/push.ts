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
  resolveRemoteWpPath,
  wpLocalDbExportToFile,
  wpLocalGetTablePrefix,
  wpRemoteBootstrapConfigFromRemoteDb,
  wpRemoteDbExport,
  wpRemoteForceSiteUrls,
  wpRemoteDbImport,
  wpRemoteSearchReplace,
} from "../services/wpcli.js";
import { ensureBackupDir, timestampedDbName } from "../services/backup.js";
import { confirmRemoteTarget } from "../utils/confirm.js";
import { logInfo } from "../utils/logger.js";
import { getUrlVariants } from "../utils/url-variants.js";
import { verifyRemoteSiteUrls } from "../utils/sync-verify.js";
import { pushExcludePatterns } from "../services/sync-excludes.js";
import { assertHostSyncTools } from "../utils/host-prereq.js";
import { posixShellQuote, remoteRmFile } from "../utils/shell-quote.js";

export type PushOptions = {
  dryRun: boolean;
  /** Skip interactive SSH-host / production confirmation (browser runner, CI). */
  yes?: boolean;
};

/** wp-dev admin must never remain on staging/production (local dev tool only). */
async function purgeRemoteWpDevAdmin(
  ssh: { exec: (command: string) => Promise<unknown> },
  remoteWpPath: string,
): Promise<void> {
  const adminDir = `${remoteWpPath.replace(/\/$/, "")}/admin`;
  logInfo(`push: remove remote wp-dev admin at ${adminDir}`);
  await ssh.exec(`rm -rf ${posixShellQuote(adminDir)}`);
}

async function sanitizeRemoteGeneratedAssetUrls(
  sshExec: (command: string) => Promise<{ code: number | null; stderr: string; stdout: string }>,
  wpPath: string,
  fromUrl: string,
  toUrl: string,
): Promise<void> {
  const cmd = [
    `ROOT_PATH=${posixShellQuote(wpPath)}`,
    `FROM_URL=${posixShellQuote(fromUrl)}`,
    `TO_URL=${posixShellQuote(toUrl)}`,
    "changed=0",
    "for d in \"$ROOT_PATH/wp-content/uploads/elementor/css\" \"$ROOT_PATH/wp-content/cache\"; do [ -d \"$d\" ] || continue; while IFS= read -r -d '' f; do if grep -q \"$FROM_URL\" \"$f\"; then sed -i \"s|$FROM_URL|$TO_URL|g\" \"$f\" && changed=$((changed+1)); fi; done < <(find \"$d\" -type f \\( -name '*.css' -o -name '*.js' -o -name '*.json' -o -name '*.txt' -o -name '*.html' -o -name '*.xml' -o -name '*.map' \\) -print0); done",
    "echo \"asset-url-sanitize changed_files=$changed\"",
  ].join("; ");
  const r = await sshExec(cmd);
  if (r.code !== 0) {
    throw new Error(`Remote asset URL sanitize failed: ${r.stderr || r.stdout}`);
  }
}

export async function cmdPush(
  loaded: LoadedConfig,
  env: RemoteEnvName,
  options: PushOptions,
): Promise<void> {
  const { config, configDir } = loaded;
  const remote = getRemoteEnv(config, env);
  const localWpRoot = resolveFromConfigDir(configDir, config.local.wpRoot);

  if (!options.dryRun && !options.yes && process.env.WPDEV_ASSUME_YES !== "1") {
    const ok = await confirmRemoteTarget(
      env,
      remote,
      "push",
    );
    if (!ok) {
      logInfo(`push ${env}: user aborted at confirmation`);
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
    await rsyncPush(remote, localWpRoot, {
      dryRun: true,
      excludes: pushExcludePatterns(configDir, config, localWpRoot),
    });
    return;
  }

  assertHostSyncTools();

  await assertLocalWpInstalled(configDir, config);
  if (env === "staging") {
    if (!remote.db) {
      throw new Error(
        "staging.db is required for push staging. Configure dedicated staging DB credentials (host/name/user/password) in wp-dev.config.json.",
      );
    }
    const prodDb = config.production.db;
    if (
      prodDb &&
      remote.db.host.trim() === prodDb.host.trim() &&
      remote.db.name.trim() === prodDb.name.trim()
    ) {
      throw new Error(
        "staging.db must be separate from production.db (different DB host/name) to avoid overwriting production data.",
      );
    }
  }

  logInfo(`push ${env}: connect ssh ${remote.user}@${remote.host}`);
  const ssh = await connectSsh(remote);
  let prePushBackup = "";
  let bootstrappedFreshRemote = false;
  try {
    let remoteWp = await resolveRemoteWpPath(ssh, remote.path);
    const shouldBootstrapStaging = env === "staging" && !remoteWp.installed;
    if (!remoteWp.installed && !shouldBootstrapStaging) {
      await assertRemoteWpInstalled(ssh, remote.path);
    }
    if (shouldBootstrapStaging) {
      logInfo(`push ${env}: remote WP not installed yet — bootstrap files only`);
      await rsyncPush(remote, localWpRoot, {
        dryRun: false,
        excludes: pushExcludePatterns(configDir, config, localWpRoot),
      });
      await purgeRemoteWpDevAdmin(ssh, remote.path);
      if (!remote.db) {
        console.error(
          `Seeded files to ${env}, but remote WordPress is not installed at ${remote.path} yet.\n` +
            `Add "${env}.db" settings in wp-dev.config.json so wp-dev can create remote wp-config.php automatically,\n` +
            `or finish installer at ${remote.url}/wp-admin/install.php, then run:\n` +
            `  npm run wp-dev -- push ${env}`,
        );
        return;
      }
      const localPrefix = await wpLocalGetTablePrefix(configDir, config);
      logInfo(`push ${env}: bootstrap remote wp-config.php from ${env}.db settings`);
      const bootPath = await wpRemoteBootstrapConfigFromRemoteDb(
        ssh,
        remote.path,
        remote,
        localPrefix,
      );
      remoteWp = { installed: true, path: bootPath };
      bootstrappedFreshRemote = true;
      logInfo(`push ${env}: bootstrap config created at ${bootPath}; proceeding with DB import`);
    }
    const wpPath = remoteWp.path ?? remote.path;
    if (wpPath !== remote.path) {
      logInfo(`push ${env}: using remote wp path ${wpPath} (configured: ${remote.path})`);
    }

    if (!bootstrappedFreshRemote) {
      const backupDir = ensureBackupDir(config.project, env);
      const preName = timestampedDbName();
      prePushBackup = join(backupDir, `pre-push-${preName}`);
      const remotePreDump = `/tmp/wp-dev-pre-push-${Date.now()}.sql`;
      logInfo(`push ${env}: remote pre-push db backup -> ${prePushBackup}`);
      await wpRemoteDbExport(ssh, wpPath, remotePreDump);
      await ssh.getFile(remotePreDump, prePushBackup);
      await ssh.exec(remoteRmFile(remotePreDump));
    } else {
      logInfo(`push ${env}: bootstrap mode — skipping pre-push remote DB backup`);
    }

    logInfo(`push ${env}: rsync files -> remote`);
    try {
      await rsyncPush(remote, localWpRoot, {
        dryRun: false,
        excludes: pushExcludePatterns(configDir, config, localWpRoot),
      });
      await purgeRemoteWpDevAdmin(ssh, wpPath);

      const tmpDir = mkdtempSync(join(tmpdir(), "wp-dev-push-"));
      const localDump = join(tmpDir, "local.sql");
      const remoteImport = `/tmp/wp-dev-push-import-${Date.now()}.sql`;
      try {
        logInfo(`push ${env}: export local db, import on remote`);
        await wpLocalDbExportToFile(configDir, config, localDump);
        await ssh.putFile(localDump, remoteImport);
        await wpRemoteDbImport(ssh, wpPath, remoteImport);
        await ssh.exec(remoteRmFile(remoteImport));
        const localCandidates = getUrlVariants(config.local.url).filter(
          (candidate) => candidate !== remote.url,
        );
        for (const fromUrl of localCandidates) {
          logInfo(`push ${env}: search-replace ${fromUrl} -> ${remote.url}`);
          await wpRemoteSearchReplace(ssh, wpPath, fromUrl, remote.url);
          logInfo(`push ${env}: sanitize generated asset files ${fromUrl} -> ${remote.url}`);
          await sanitizeRemoteGeneratedAssetUrls(
            (command) => ssh.exec(command),
            wpPath,
            fromUrl,
            remote.url,
          );
        }
        if (env === "staging" && config.production.url !== remote.url) {
          const productionCandidates = getUrlVariants(config.production.url).filter(
            (candidate) => candidate !== remote.url,
          );
          for (const fromUrl of productionCandidates) {
            logInfo(`push ${env}: search-replace ${fromUrl} -> ${remote.url}`);
            await wpRemoteSearchReplace(ssh, wpPath, fromUrl, remote.url);
            logInfo(`push ${env}: sanitize generated asset files ${fromUrl} -> ${remote.url}`);
            await sanitizeRemoteGeneratedAssetUrls(
              (command) => ssh.exec(command),
              wpPath,
              fromUrl,
              remote.url,
            );
          }
        }
        logInfo(`push ${env}: force option home/siteurl -> ${remote.url}`);
        await wpRemoteForceSiteUrls(ssh, wpPath, remote.url);
        await ssh.exec(
          `cd ${posixShellQuote(wpPath)} && wp cache flush --allow-root || true && wp elementor flush_css --allow-root || true`,
        );
        const urlCheck = await verifyRemoteSiteUrls(ssh, wpPath, remote.url);
        if (!urlCheck.ok) {
          throw new Error(
            `Post-sync URL verification failed: home=${urlCheck.home ?? "?"} siteurl=${urlCheck.siteurl ?? "?"} expected=${urlCheck.expected}`,
          );
        }
      } finally {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch (syncErr) {
      if (prePushBackup && !bootstrappedFreshRemote) {
        logInfo(`push ${env}: sync failed — rolling back remote DB from ${prePushBackup}`);
        try {
          const remoteRollback = `/tmp/wp-dev-push-rollback-${Date.now()}.sql`;
          await ssh.putFile(prePushBackup, remoteRollback);
          await wpRemoteDbImport(ssh, wpPath, remoteRollback);
          await ssh.exec(remoteRmFile(remoteRollback));
          console.error(
            `Rolled back remote DB from pre-push backup: ${prePushBackup}\n` +
              "Remote files may still differ — re-run push or restore from a full backup.",
          );
        } catch (rollbackErr) {
          const rb = rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr);
          console.error(
            `Warning: could not roll back remote DB (${rb}). Pre-push backup kept at: ${prePushBackup}`,
          );
        }
      }
      throw syncErr;
    }
  } finally {
    ssh.dispose();
  }

  if (prePushBackup) {
    console.error(`Push to ${env} complete. Remote pre-push DB backup: ${prePushBackup}`);
  } else {
    console.error(`Push to ${env} complete.`);
  }
}

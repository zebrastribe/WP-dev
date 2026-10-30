import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execa } from "execa";
import type { LoadedConfig } from "../config/load.js";
import { resolveFromConfigDir } from "../config/load.js";
import { getRemoteEnv, type RemoteEnvName } from "../config/schema.js";
import {
  chownBackupArtifact,
  ensureBackupDir,
  timestampedPreRestoreName,
} from "../services/backup.js";
import { assertRestoreBackupPath } from "../utils/restore-path.js";
import { connectSsh } from "../services/ssh.js";
import { assertRemotePathSafe } from "../services/remote-path-safety.js";
import {
  assertLocalWpInstalled,
  assertRemoteWpInstalled,
  assertTablePrefixesCompatible,
  wpLocalDbExportToFile,
  wpLocalDbImportFromFile,
  wpLocalGetTablePrefix,
  wpRemoteDbExport,
  wpRemoteDbImport,
  wpRemoteGetTablePrefix,
} from "../services/wpcli.js";
import { detectTablePrefixFromSqlDump } from "../utils/sql-dump-prefix.js";
import { assertValidSqlDump } from "../utils/sql-dump-validate.js";
import { confirmRemoteTarget } from "../utils/confirm.js";
import { acquireSyncLock, releaseSyncLock } from "@wpdev/sync-engine";
import { logInfo } from "../utils/logger.js";
import { posixShellQuote, remoteRmFile, remoteRmRf } from "../utils/shell-quote.js";
import { runLocalWordpressFileMutation } from "../fs/index.js";
import {
  buildRemoteArchiveRsyncShell,
  remoteExtractDbPath,
  remotePreRestoreDumpPath,
  type RestoreArchiveKind,
} from "../utils/restore-archive-order.js";
import {
  DISK_NEED,
  assertLocalFreeSpace,
  assertRemoteFreeSpace,
} from "../utils/disk-space.js";

export type RestoreTarget = RemoteEnvName | "local";

export type RestoreOptions = {
  yes?: boolean;
  /** Required with --yes for staging: must equal staging.host */
  confirmHost?: string;
};

type ArchiveKind = RestoreArchiveKind;

function detectArchiveKind(extractDir: string): ArchiveKind {
  const hasDb = existsSync(join(extractDir, "db.sql"));
  if (!hasDb) {
    throw new Error("Invalid backup archive: missing db.sql");
  }
  if (existsSync(join(extractDir, "site"))) {
    return "complete";
  }
  if (existsSync(join(extractDir, "wp-content"))) {
    return "content";
  }
  throw new Error(
    "Invalid backup archive: expected site/ (complete) or wp-content/ (content) alongside db.sql",
  );
}

async function extractArchiveLocal(archivePath: string, destDir: string): Promise<void> {
  await execa("tar", ["-xzf", archivePath, "-C", destDir], { reject: true });
}

/**
 * Restore a local content or complete archive: files first, then DB (F-018).
 * Complete archives preserve the live wp-config.php (secrets stay on the install).
 */
async function restoreLocalArchive(
  loaded: LoadedConfig,
  archivePath: string,
  preRestore: string,
): Promise<ArchiveKind> {
  const { config, configDir } = loaded;
  const wpRoot = resolveFromConfigDir(configDir, config.local.wpRoot);
  const tmp = mkdtempSync(join(tmpdir(), "wpdev-restore-"));
  try {
    await extractArchiveLocal(archivePath, tmp);
    const kind = detectArchiveKind(tmp);
    const dbSql = join(tmp, "db.sql");
    const sql = readFileSync(dbSql, "utf8");
    assertValidSqlDump(sql, "Restore archive db.sql");
    const dumpPrefix = detectTablePrefixFromSqlDump(sql);
    const localPrefix = await wpLocalGetTablePrefix(configDir, config);
    assertTablePrefixesCompatible(dumpPrefix, localPrefix, "restore local");

    assertLocalFreeSpace(tmpdir(), DISK_NEED.dbBackupLocal, "restore local");

    await wpLocalDbExportToFile(configDir, config, preRestore);
    chownBackupArtifact(preRestore, configDir);

    // Single permissions envelope (same as pull) — do not call host/post reconcile ad hoc.
    await runLocalWordpressFileMutation(loaded, { label: "restore local" }, async () => {
      // Files before DB — failed rsync must not leave a replaced database.
      try {
        if (kind === "content") {
          const dest = join(wpRoot, "wp-content");
          await execa("mkdir", ["-p", dest]);
          await execa(
            "rsync",
            ["-a", "--delete", `${join(tmp, "wp-content")}/`, `${dest}/`],
            { reject: true },
          );
        } else {
          await execa(
            "rsync",
            [
              "-a",
              "--delete",
              "--exclude",
              "wp-config.php",
              "--exclude",
              "wp-config-*.php",
              `${join(tmp, "site")}/`,
              `${wpRoot}/`,
            ],
            { reject: true },
          );
        }
      } catch (rsyncErr) {
        const msg = rsyncErr instanceof Error ? rsyncErr.message : String(rsyncErr);
        throw new Error(
          `restore local: rsync failed (database unchanged): ${msg}. ` +
            `If this is a permission error, run: npm run wp-dev -- fix-permissions`,
        );
      }

      try {
        await wpLocalDbImportFromFile(configDir, config, dbSql);
      } catch (dbErr) {
        const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
        logInfo(`restore local archive: DB import failed — rolling back from ${preRestore}`);
        try {
          await wpLocalDbImportFromFile(configDir, config, preRestore);
          throw new Error(
            `Local archive files were restored, but DB import failed (${msg}). ` +
              `DB rolled back from pre-restore backup: ${preRestore}.`,
          );
        } catch (rollbackErr) {
          if (rollbackErr instanceof Error && rollbackErr.message.includes("DB rolled back")) {
            throw rollbackErr;
          }
          const rb = rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr);
          throw new Error(
            `Local archive files were restored, but DB import failed (${msg}). ` +
              `DB rollback also failed (${rb}). Pre-restore dump: ${preRestore}.`,
          );
        }
      }
    });
    return kind;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Restore a remote content or complete archive: files first, then DB (F-018).
 * On DB import failure after successful rsync, attempts DB rollback from remote pre.sql.
 */
async function restoreRemoteArchive(
  loaded: LoadedConfig,
  env: RemoteEnvName,
  archivePath: string,
  preRestoreLocal: string,
): Promise<ArchiveKind> {
  const { config, configDir } = loaded;
  const remote = getRemoteEnv(config, env);
  const ssh = await connectSsh(remote);
  const remoteWork = `/tmp/wpdev-restore-${Date.now()}`;
  const remoteArchive = `${remoteWork}/backup.tar.gz`;
  const remotePreDump = remotePreRestoreDumpPath(remoteWork);
  const remoteDbSql = remoteExtractDbPath(remoteWork);
  let filesSynced = false;

  try {
    await assertRemotePathSafe(ssh, remote.path, env);
    const wpPath = await assertRemoteWpInstalled(ssh, remote.path);
    const wpQ = posixShellQuote(wpPath);

    await assertRemoteFreeSpace(ssh, "/tmp", DISK_NEED.dbBackupRemoteTmp, `restore ${env}`);
    assertLocalFreeSpace(tmpdir(), DISK_NEED.dbBackupLocal, `restore ${env}`);

    logInfo(`restore ${env}: pre-restore remote db backup -> ${preRestoreLocal}`);
    await ssh.exec(`mkdir -p ${posixShellQuote(remoteWork)}`);
    await wpRemoteDbExport(ssh, wpPath, remotePreDump);
    await ssh.getFile(remotePreDump, preRestoreLocal);
    chownBackupArtifact(preRestoreLocal, configDir);

    await ssh.putFile(archivePath, remoteArchive);
    const unpacked = await ssh.exec(
      [
        "set -e",
        `mkdir -p ${remoteWork}/extract`,
        `tar -xzf ${remoteArchive} -C ${remoteWork}/extract`,
        `test -f ${remoteDbSql}`,
      ].join("; "),
    );
    if (unpacked.code !== 0) {
      throw new Error(
        `Remote archive extract failed: ${unpacked.stderr || unpacked.stdout}`,
      );
    }

    const kindProbe = await ssh.exec(
      [
        `if [ -d ${remoteWork}/extract/site ]; then echo complete;`,
        `elif [ -d ${remoteWork}/extract/wp-content ]; then echo content;`,
        `else echo invalid; fi`,
      ].join(" "),
    );
    const kindRaw = (kindProbe.stdout || "").trim();
    if (kindRaw !== "complete" && kindRaw !== "content") {
      throw new Error(
        "Invalid backup archive on remote: expected site/ (complete) or wp-content/ (content)",
      );
    }
    const kind = kindRaw as ArchiveKind;

    const localDbDir = mkdtempSync(join(tmpdir(), "wpdev-restore-db-"));
    const localDbProbe = join(localDbDir, "db.sql");
    try {
      await ssh.getFile(remoteDbSql, localDbProbe);
      const sql = readFileSync(localDbProbe, "utf8");
      assertValidSqlDump(sql, "Remote restore archive db.sql");
      const dumpPrefix = detectTablePrefixFromSqlDump(sql);
      const remotePrefix = await wpRemoteGetTablePrefix(ssh, wpPath);
      assertTablePrefixesCompatible(dumpPrefix, remotePrefix, `restore ${env}`);
    } finally {
      rmSync(localDbDir, { recursive: true, force: true });
    }

    logInfo(`restore ${env}: rsync archive files (before DB import)`);
    const sync = await ssh.exec(buildRemoteArchiveRsyncShell(kind, remoteWork, wpQ));
    if (sync.code !== 0) {
      throw new Error(
        `Remote ${kind} restore rsync failed (database unchanged): ${sync.stderr || sync.stdout}`,
      );
    }
    filesSynced = true;

    try {
      await wpRemoteDbImport(ssh, wpPath, remoteDbSql);
    } catch (dbErr) {
      const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
      logInfo(`restore ${env}: DB import failed after files sync — rolling back remote DB`);
      let rolledBack = false;
      try {
        await wpRemoteDbImport(ssh, wpPath, remotePreDump);
        rolledBack = true;
      } catch (rollbackErr) {
        const rb = rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr);
        throw new Error(
          `Remote archive files were restored; DB import failed (${msg}); ` +
            `DB rollback also failed (${rb}). Pre-restore dump kept at ${preRestoreLocal} and ${remotePreDump}.`,
        );
      }
      if (rolledBack) {
        throw new Error(
          `Remote archive files were restored, but DB import failed (${msg}). ` +
            `Remote DB was rolled back from pre-restore dump. Local copy: ${preRestoreLocal}.`,
        );
      }
    }

    await ssh.exec(remoteRmRf(remoteWork));
    return kind;
  } catch (e) {
    if (!filesSynced) {
      try {
        await ssh.exec(remoteRmRf(remoteWork));
      } catch {
        /* cleanup */
      }
    } else {
      // Keep remoteWork (includes pre.sql) when files changed and recovery may need it.
      console.error(
        `Warning: leaving ${remoteWork} on remote for recovery (includes pre.sql). Remove when done.`,
      );
    }
    throw e;
  } finally {
    ssh.dispose();
  }
}

export async function cmdRestore(
  loaded: LoadedConfig,
  env: RestoreTarget,
  file: string,
  opts: RestoreOptions = {},
): Promise<void> {
  const { config, configDir } = loaded;
  const resolvedFile = assertRestoreBackupPath(config.project, env, file);
  const isArchive = resolvedFile.endsWith(".tar.gz");

  logInfo(`restore ${env} from ${resolvedFile}`);

  // Confirm before taking the sync lock (do not block other syncs while prompting).
  if (env !== "local") {
    const remote = getRemoteEnv(config, env);
    const ok = await confirmRemoteTarget(env, remote, "restore", {
      yes: Boolean(opts.yes) || process.env.WPDEV_ASSUME_YES === "1",
      confirmHost: opts.confirmHost,
    });
    if (!ok) {
      logInfo(`restore ${env}: user aborted at confirmation`);
      console.error("Aborted.");
      process.exitCode = 1;
      return;
    }
  }

  const syncLock = acquireSyncLock(config.project, `restore:${env}`);
  try {
    const backupDir = ensureBackupDir(config.project, env);
    const preRestore = join(backupDir, timestampedPreRestoreName());

    if (env === "local") {
      await assertLocalWpInstalled(configDir, config);
      if (isArchive) {
        const kind = await restoreLocalArchive(loaded, resolvedFile, preRestore);
        const label =
          kind === "complete"
            ? "complete (DB + WordPress tree)"
            : "content (DB + wp-content)";
        console.error(
          `Local ${label} restored from backup. Pre-restore DB backup: ${preRestore}`,
        );
        return;
      }
      logInfo(`restore local: pre-restore db backup -> ${preRestore}`);
      const sql = readFileSync(resolvedFile, "utf8");
      assertValidSqlDump(sql, "Restore SQL dump");
      const dumpPrefix = detectTablePrefixFromSqlDump(sql);
      const localPrefix = await wpLocalGetTablePrefix(configDir, config);
      assertTablePrefixesCompatible(dumpPrefix, localPrefix, "restore local");
      await wpLocalDbExportToFile(configDir, config, preRestore);
      chownBackupArtifact(preRestore, configDir);
      try {
        await wpLocalDbImportFromFile(configDir, config, resolvedFile);
      } catch (importErr) {
        logInfo(`restore local: import failed — rolling back DB from ${preRestore}`);
        try {
          await wpLocalDbImportFromFile(configDir, config, preRestore);
          console.error(
            `Local restore failed; rolled back DB from pre-restore backup: ${preRestore}`,
          );
        } catch (rollbackErr) {
          const rb = rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr);
          console.error(
            `Warning: local restore failed and DB rollback also failed (${rb}). ` +
              `Pre-restore dump kept at: ${preRestore}`,
          );
        }
        throw importErr;
      }
      console.error(`Local database restored from backup. Pre-restore DB backup: ${preRestore}`);
      return;
    }

    if (isArchive) {
      const kind = await restoreRemoteArchive(
        loaded,
        env,
        resolvedFile,
        preRestore,
      );
      const label =
        kind === "complete"
          ? "complete (DB + WordPress tree)"
          : "content (DB + wp-content)";
      console.error(
        `${env} ${label} restored from ${resolvedFile}. Pre-restore DB backup: ${preRestore}`,
      );
      return;
    }

    const remote = getRemoteEnv(config, env);
    const ssh = await connectSsh(remote);
    const remoteImport = `/tmp/wp-dev-restore-${Date.now()}.sql`;
    const remotePreDump = `/tmp/wp-dev-pre-restore-${Date.now()}.sql`;
    try {
      await assertRemotePathSafe(ssh, remote.path, env);
      const wpPath = await assertRemoteWpInstalled(ssh, remote.path);
      await assertRemoteFreeSpace(ssh, "/tmp", DISK_NEED.dbBackupRemoteTmp, `restore ${env}`);

      logInfo(`restore ${env}: pre-restore remote db backup -> ${preRestore}`);
      try {
        await wpRemoteDbExport(ssh, wpPath, remotePreDump);
        await ssh.getFile(remotePreDump, preRestore);
        chownBackupArtifact(preRestore, configDir);
      } finally {
        try {
          await ssh.exec(remoteRmFile(remotePreDump));
        } catch {
          /* best-effort */
        }
      }

      const sqlText = readFileSync(resolvedFile, "utf8");
      assertValidSqlDump(sqlText, "Restore SQL dump");
      const dumpPrefix = detectTablePrefixFromSqlDump(sqlText);
      const remotePrefix = await wpRemoteGetTablePrefix(ssh, wpPath);
      assertTablePrefixesCompatible(dumpPrefix, remotePrefix, `restore ${env}`);

      try {
        await ssh.putFile(resolvedFile, remoteImport);
        await wpRemoteDbImport(ssh, wpPath, remoteImport);
      } finally {
        try {
          await ssh.exec(remoteRmFile(remoteImport));
        } catch {
          /* best-effort */
        }
      }
    } finally {
      ssh.dispose();
    }

    console.error(
      `${env} database restored from ${resolvedFile}. Pre-restore DB backup: ${preRestore}`,
    );
  } finally {
    releaseSyncLock(syncLock);
  }
}

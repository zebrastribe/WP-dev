import { existsSync, mkdtempSync, rmSync } from "node:fs";
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
  wpLocalDbExportToFile,
  wpLocalDbImportFromFile,
  wpRemoteDbExport,
  wpRemoteDbImport,
} from "../services/wpcli.js";
import { confirmRemoteTarget } from "../utils/confirm.js";
import { acquireSyncLock, releaseSyncLock } from "../utils/sync-lock.js";
import { logInfo } from "../utils/logger.js";
import { posixShellQuote, remoteRmFile, remoteRmRf } from "../utils/shell-quote.js";
import { cmdFixRuntimeWritePermissions } from "./fix-permissions.js";

export type RestoreTarget = RemoteEnvName | "local";

export type RestoreOptions = {
  yes?: boolean;
  /** Required with --yes for staging: must equal staging.host */
  confirmHost?: string;
};

type ArchiveKind = "content" | "complete";

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
 * Restore a local content or complete archive: DB + files.
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
    await wpLocalDbExportToFile(configDir, config, preRestore);
    chownBackupArtifact(preRestore, configDir);
    await wpLocalDbImportFromFile(configDir, config, join(tmp, "db.sql"));

    if (kind === "content") {
      const dest = join(wpRoot, "wp-content");
      await execa("mkdir", ["-p", dest]);
      await execa(
        "rsync",
        ["-a", "--delete", `${join(tmp, "wp-content")}/`, `${dest}/`],
        { reject: true },
      );
    } else {
      // Preserve live secrets; archive deliberately omits wp-config.php.
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

    try {
      await cmdFixRuntimeWritePermissions(loaded, { quiet: true });
    } catch {
      /* best-effort */
    }
    return kind;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Restore a remote content or complete archive taken from the same env (no URL rewrite).
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
  try {
    await assertRemotePathSafe(ssh, remote.path, env);
    const wpPath = await assertRemoteWpInstalled(ssh, remote.path);
    const wpQ = posixShellQuote(wpPath);

    logInfo(`restore ${env}: pre-restore remote db backup -> ${preRestoreLocal}`);
    const remotePreDump = `${remoteWork}/pre.sql`;
    await ssh.exec(`mkdir -p ${remoteWork}`);
    await wpRemoteDbExport(ssh, wpPath, remotePreDump);
    await ssh.getFile(remotePreDump, preRestoreLocal);
    chownBackupArtifact(preRestoreLocal, configDir);

    await ssh.putFile(archivePath, remoteArchive);
    const unpacked = await ssh.exec(
      [
        "set -e",
        `mkdir -p ${remoteWork}/extract`,
        `tar -xzf ${remoteArchive} -C ${remoteWork}/extract`,
        `test -f ${remoteWork}/extract/db.sql`,
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

    await wpRemoteDbImport(ssh, wpPath, `${remoteWork}/extract/db.sql`);

    if (kind === "content") {
      const sync = await ssh.exec(
        [
          "set -e",
          `mkdir -p ${wpQ}/wp-content`,
          `rsync -a --delete ${remoteWork}/extract/wp-content/ ${wpQ}/wp-content/`,
        ].join("; "),
      );
      if (sync.code !== 0) {
        throw new Error(
          `Remote content restore rsync failed: ${sync.stderr || sync.stdout}`,
        );
      }
    } else {
      const sync = await ssh.exec(
        [
          "set -e",
          `rsync -a --delete --exclude=wp-config.php --exclude='wp-config-*.php' ${remoteWork}/extract/site/ ${wpQ}/`,
        ].join("; "),
      );
      if (sync.code !== 0) {
        throw new Error(
          `Remote complete restore rsync failed: ${sync.stderr || sync.stdout}`,
        );
      }
    }

    await ssh.exec(remoteRmRf(remoteWork));
    return kind;
  } catch (e) {
    try {
      await ssh.exec(remoteRmRf(remoteWork));
    } catch {
      /* cleanup */
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
      await wpLocalDbExportToFile(configDir, config, preRestore);
      chownBackupArtifact(preRestore, configDir);
      await wpLocalDbImportFromFile(configDir, config, resolvedFile);
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
    try {
      await assertRemotePathSafe(ssh, remote.path, env);
      const wpPath = await assertRemoteWpInstalled(ssh, remote.path);
      logInfo(`restore ${env}: pre-restore remote db backup -> ${preRestore}`);
      const remotePreDump = `/tmp/wp-dev-pre-restore-${Date.now()}.sql`;
      await wpRemoteDbExport(ssh, wpPath, remotePreDump);
      await ssh.getFile(remotePreDump, preRestore);
      chownBackupArtifact(preRestore, configDir);
      await ssh.exec(remoteRmFile(remotePreDump));

      await ssh.putFile(resolvedFile, remoteImport);
      await wpRemoteDbImport(ssh, wpPath, remoteImport);
      await ssh.exec(remoteRmFile(remoteImport));
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

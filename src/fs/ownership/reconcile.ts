import type { LoadedConfig } from "../../config/load.js";
import { compose } from "../../services/docker-compose.js";
import { resolveHostIdentity } from "../../utils/host-paths.js";
import {
  cmdFixHostOwnershipOnly,
  cmdFixPermissions,
  cmdFixRuntimeWritePermissions,
} from "../../commands/fix-permissions.js";
import { assertDockerReady } from "../../utils/docker-prereq.js";
import { logInfo } from "../../utils/logger.js";
import { fsAuditLog } from "../audit-log.js";
import { writeJsonAtomic } from "../atomic-write.js";
import { ownershipManifestPath, projectConfigPath, projectDockerDir, projectDockerEnvPath } from "../path-resolver.js";
import { detectPlatform } from "../platform/detect.js";
import { buildOwnershipManifest } from "./profiles.js";

/**
 * Ensure shared config paths stay writable by host CLI + www-data admin API,
 * without world-readable secrets (replaces chmod 666/777 band-aids).
 * - wp-dev.config.json: 664 host:host (non-secret project config)
 * - docker/.env: 660 host:www-data (secrets; owner + Apache group only)
 * - logs/: 2775 host:www-data so Apache can append wp-dev-admin-api.log
 */
export function buildSharedConfigReconcileShell(
  hostUid: number,
  hostGid: number,
  wwwDataGid: number = 33,
): string {
  return [
    "mkdir -p /wp-dev-repo/docker /wp-dev-repo/logs",
    "touch /wp-dev-repo/wp-dev.config.json /wp-dev-repo/docker/.env",
    `chown ${hostUid}:${hostGid} /wp-dev-repo/wp-dev.config.json`,
    `chown ${hostUid}:${wwwDataGid} /wp-dev-repo/docker/.env`,
    `if [ -f /wp-dev-repo/docker/.env.bak ]; then chown ${hostUid}:${wwwDataGid} /wp-dev-repo/docker/.env.bak && chmod 660 /wp-dev-repo/docker/.env.bak; fi`,
    `chown ${hostUid}:${hostGid} /wp-dev-repo/docker`,
    // www-data must create/append admin API log; setgid keeps new files group-writable.
    `chown ${hostUid}:${wwwDataGid} /wp-dev-repo/logs`,
    "chmod 775 /wp-dev-repo/docker",
    "chmod 2775 /wp-dev-repo/logs",
    "chmod 664 /wp-dev-repo/wp-dev.config.json",
    "chmod 660 /wp-dev-repo/docker/.env",
    `if [ -f /wp-dev-repo/logs/wp-dev-admin-api.log ]; then chown ${hostUid}:${wwwDataGid} /wp-dev-repo/logs/wp-dev-admin-api.log && chmod 664 /wp-dev-repo/logs/wp-dev-admin-api.log; fi`,
  ].join(" && ");
}

export async function reconcileSharedConfig(loaded: LoadedConfig): Promise<void> {
  assertDockerReady();
  // Prefer host bind ownership — process may be root inside the terminal container.
  const { uid, gid } = resolveHostIdentity(loaded.configDir);
  if (uid < 0 || gid < 0) return;

  logInfo("fs: reconcile shared config paths (wp-dev.config.json, docker/.env)");
  await compose(
    loaded.configDir,
    loaded.config,
    [
      "exec",
      "-T",
      "-u",
      "0",
      "wordpress",
      "sh",
      "-lc",
      buildSharedConfigReconcileShell(uid, gid),
    ],
    { stdio: "pipe" },
  ).catch(async () => {
    await compose(
      loaded.configDir,
      loaded.config,
      [
        "run",
        "--rm",
        "--no-deps",
        "-u",
        "0",
        "wordpress",
        "sh",
        "-lc",
        buildSharedConfigReconcileShell(uid, gid),
      ],
      { stdio: "pipe" },
    );
  });

  fsAuditLog(loaded.configDir, loaded.config.project, "fs.reconcile", {
    profile: "SHARED_CONFIG",
  });
}

/**
 * Entire wordpress/ tree owned by the host user — safe for host-side rsync/CLI edits.
 * Does **not** apply www-data runtime ownership (that blocks host rsync into uploads/plugins).
 */
export async function reconcileHostEditable(loaded: LoadedConfig): Promise<void> {
  await cmdFixHostOwnershipOnly(loaded, { quiet: true });
  fsAuditLog(loaded.configDir, loaded.config.project, "fs.reconcile", {
    profile: "HOST_EDITABLE",
  });
}

/** Alias: host-writable before rsync (same as reconcileHostEditable). */
export async function reconcileHostWritableForRsync(loaded: LoadedConfig): Promise<void> {
  await reconcileHostEditable(loaded);
}

export async function reconcileContainerRuntime(loaded: LoadedConfig): Promise<void> {
  await cmdFixRuntimeWritePermissions(loaded, { quiet: true });
  fsAuditLog(loaded.configDir, loaded.config.project, "fs.reconcile", {
    profile: "CONTAINER_RUNTIME",
  });
}

export async function reconcileAllProfiles(loaded: LoadedConfig): Promise<void> {
  const platform = detectPlatform();
  const manifest = buildOwnershipManifest(platform.hostUid, platform.hostGid);
  manifest.lastReconciled = new Date().toISOString();

  await reconcileSharedConfig(loaded);
  await reconcileContainerRuntime(loaded);

  writeJsonAtomic(ownershipManifestPath(loaded.configDir), manifest, {
    configDir: loaded.configDir,
    projectId: loaded.config.project,
  });
}

export async function reconcileAfterPull(loaded: LoadedConfig): Promise<void> {
  // Full host own + runtime www-data + shared config (post-sync).
  await cmdFixPermissions(loaded, { quiet: true });
  await reconcileSharedConfig(loaded);
}

export function getManagedPathsForProbe(loaded: LoadedConfig): string[] {
  return [
    projectConfigPath(loaded.configDir),
    projectDockerEnvPath(loaded.configDir, loaded.config.local.path),
    projectDockerDir(loaded.configDir, loaded.config.local.path),
  ];
}

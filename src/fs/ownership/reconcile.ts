import { userInfo } from "node:os";
import type { LoadedConfig } from "../../config/load.js";
import { compose } from "../../services/docker-compose.js";
import {
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
 * Ensure shared config paths are host-owned with safe modes (664 files, 775 dirs).
 * Replaces chmod 666/777 band-aids — both host CLI and container root can write.
 */
export function buildSharedConfigReconcileShell(
  hostUid: number,
  hostGid: number,
): string {
  return [
    "mkdir -p /wp-dev-repo/docker /wp-dev-repo/logs",
    "touch /wp-dev-repo/wp-dev.config.json /wp-dev-repo/docker/.env",
    `chown ${hostUid}:${hostGid} /wp-dev-repo/wp-dev.config.json /wp-dev-repo/docker/.env`,
    `chown ${hostUid}:${hostGid} /wp-dev-repo/docker /wp-dev-repo/logs`,
    "chmod 775 /wp-dev-repo/docker /wp-dev-repo/logs",
    "chmod 664 /wp-dev-repo/wp-dev.config.json /wp-dev-repo/docker/.env",
  ].join(" && ");
}

export async function reconcileSharedConfig(loaded: LoadedConfig): Promise<void> {
  assertDockerReady();
  const { uid, gid } = userInfo();
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

export async function reconcileHostEditable(loaded: LoadedConfig): Promise<void> {
  await cmdFixPermissions(loaded, { quiet: true });
  fsAuditLog(loaded.configDir, loaded.config.project, "fs.reconcile", {
    profile: "HOST_EDITABLE",
  });
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
  await reconcileHostEditable(loaded);
  await reconcileContainerRuntime(loaded);
  await reconcileSharedConfig(loaded);
}

export function getManagedPathsForProbe(loaded: LoadedConfig): string[] {
  return [
    projectConfigPath(loaded.configDir),
    projectDockerEnvPath(loaded.configDir, loaded.config.local.path),
    projectDockerDir(loaded.configDir, loaded.config.local.path),
  ];
}

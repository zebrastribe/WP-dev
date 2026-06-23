import { existsSync, unlinkSync } from "node:fs";
import type { LoadedConfig } from "../config/load.js";
import { emitLifecycleEvent } from "./lifecycle-log.js";
import { removeStaleLock, readLockData } from "./project-lock.js";
import { cleanupPidFile, reclaimPortListeners } from "./process-manager.js";
import { hostRunnerPidPath, supervisorPidPath } from "./paths.js";
import { loadRegistry, saveRegistry, setShutdownPhase } from "./service-registry.js";
import type { PortConflictInfo } from "./types.js";

export async function recoverStaleState(loaded: LoadedConfig): Promise<void> {
  const { configDir, config } = loaded;
  if (removeStaleLock(configDir)) {
    emitLifecycleEvent(configDir, config.project, "recovery.stale_lock", {});
  }

  await cleanupPidFile(hostRunnerPidPath(configDir), configDir, config.project, "host-runner");

  const registry = loadRegistry(configDir);
  if (registry && registry.shutdownPhase !== "complete" && registry.shutdownPhase !== "none") {
    emitLifecycleEvent(configDir, config.project, "recovery.stale_lock", {
      shutdownPhase: registry.shutdownPhase,
    });
    saveRegistry(configDir, setShutdownPhase(registry, "none"));
  }
}

export async function reclaimPortConflicts(
  loaded: LoadedConfig,
  conflicts: PortConflictInfo[],
): Promise<void> {
  const wpDevPids = conflicts
    .filter((c) => c.ownedByRegistry && c.ownerPid)
    .map((c) => c.ownerPid!);
  await reclaimPortListeners(wpDevPids, loaded.configDir, loaded.config.project);
}

export function getRunningSupervisorInfo(configDir: string): {
  pid: number;
  port: number;
} | null {
  const lock = readLockData(configDir);
  if (!lock) return null;
  try {
    process.kill(lock.pid, 0);
    return { pid: lock.pid, port: lock.supervisorPort };
  } catch {
    return null;
  }
}

export function readSupervisorPid(configDir: string): number | null {
  const info = getRunningSupervisorInfo(configDir);
  if (info) return info.pid;
  const fromFile = loadRegistry(configDir);
  if (fromFile && fromFile.supervisorPid) {
    try {
      process.kill(fromFile.supervisorPid, 0);
      return fromFile.supervisorPid;
    } catch {
      return null;
    }
  }
  return null;
}

export function cleanupSupervisorPidFile(configDir: string): void {
  const path = supervisorPidPath(configDir);
  if (!existsSync(path)) return;
  try {
    unlinkSync(path);
  } catch {
    /* ignore */
  }
}

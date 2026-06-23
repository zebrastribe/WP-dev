import type { LoadedConfig } from "../config/load.js";
import { compose } from "../services/docker-compose.js";
import { cleanupLegacyHostRunner } from "../services/host-runner.js";
import { logInfo } from "../utils/logger.js";
import { emitLifecycleEvent } from "./lifecycle-log.js";
import { waitForPortFree } from "./port-probe.js";
import { ProjectLock, removeStaleLock } from "./project-lock.js";
import {
  loadRegistry,
  saveRegistry,
  setShutdownPhase,
} from "./service-registry.js";
import type { DockerEnvPortKey } from "../utils/compose-env.js";
import { cleanupSupervisorPidFile } from "./recovery.js";

export type ShutdownOptions = {
  removeOrphans?: boolean;
};

export async function runShutdownStateMachine(
  loaded: LoadedConfig,
  options: ShutdownOptions = {},
): Promise<void> {
  const { configDir, config } = loaded;
  emitLifecycleEvent(configDir, config.project, "lifecycle.shutdown", {});

  let registry = loadRegistry(configDir);
  const phases = [
    "stop_accepting",
    "notify_services",
    "cancel_jobs",
    "flush_work",
    "close_sockets",
    "terminate_children",
    "compose_down",
    "release_ports",
    "remove_pid_files",
    "remove_lock",
    "persist_clean",
    "verify_cleanup",
    "complete",
  ] as const;

  for (const phase of phases) {
    if (registry) {
      registry = setShutdownPhase(registry, phase);
      saveRegistry(configDir, registry);
    }

    if (phase === "terminate_children") {
      await cleanupLegacyHostRunner(configDir);
    }

    if (phase === "compose_down") {
      const args = ["down", ...(options.removeOrphans ? ["--remove-orphans"] : [])];
      logInfo(`docker compose ${args.join(" ")}`);
      await compose(configDir, config, args);
    }

    if (phase === "release_ports" && registry) {
      for (const [key, port] of Object.entries(registry.ports) as [DockerEnvPortKey, number][]) {
        const free = await waitForPortFree(port, 5_000);
        if (!free) {
          logInfo(`shutdown: port ${key}=${port} still bound after compose down`);
        }
      }
    }

    if (phase === "remove_lock") {
      removeStaleLock(configDir);
      try {
        const lock = new ProjectLock(configDir);
        lock.release();
      } catch {
        /* ignore */
      }
    }

    if (phase === "persist_clean" && registry) {
      registry = { ...registry, services: [] };
      saveRegistry(configDir, registry);
    }
  }

  cleanupSupervisorPidFile(configDir);
  if (registry) {
    registry = setShutdownPhase(registry, "complete");
    saveRegistry(configDir, registry);
  }
  emitLifecycleEvent(configDir, config.project, "lifecycle.shutdown", { complete: true });
}

export function releaseProjectLock(lock: ProjectLock | null): void {
  lock?.release();
}

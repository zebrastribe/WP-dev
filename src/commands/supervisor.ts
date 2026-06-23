import type { LoadedConfig } from "../config/load.js";
import {
  fetchSupervisorServices,
  resolveSupervisorPort,
  supervisorHealth,
} from "../supervisor/client.js";
import { loadRegistry } from "../supervisor/service-registry.js";
import { registryPath, lifecycleLogPath, lockPath } from "../supervisor/paths.js";
import { isLockStale, readLockData } from "../supervisor/project-lock.js";

export async function cmdSupervisorStatus(loaded: LoadedConfig): Promise<void> {
  const { getRunningSupervisorInfo } = await import("../supervisor/client.js");
  const info = getRunningSupervisorInfo(loaded.configDir);
  const port = info?.port ?? resolveSupervisorPort(loaded);
  const healthy = await supervisorHealth(port);

  console.error(`Project:     ${loaded.config.project}`);
  console.error(`Supervisor:  ${healthy ? "running" : "not running"}`);
  if (info) {
    console.error(`  PID:       ${info.pid}`);
    console.error(`  HTTP:      http://127.0.0.1:${info.port}/health`);
  }
  console.error(`Lock file:   ${lockPath(loaded.configDir)}`);
  const lock = readLockData(loaded.configDir);
  if (lock) {
    console.error(`  held by:   PID ${lock.pid} since ${lock.startedAt}`);
  } else if (isLockStale(loaded.configDir)) {
    console.error("  (stale lock detected — will be removed on next up)");
  }
  console.error(`Registry:    ${registryPath(loaded.configDir)}`);
  console.error(`Lifecycle:   ${lifecycleLogPath(loaded.configDir)}`);

  const reg = (await fetchSupervisorServices(port)) ?? loadRegistry(loaded.configDir);
  if (reg) {
    console.error(`\nServices (${reg.services.length}):`);
    for (const s of reg.services) {
      const portStr = s.port != null ? `:${s.port}` : "";
      console.error(
        `  ${s.name.padEnd(18)} ${s.status.padEnd(10)} health=${s.health}${portStr}`,
      );
    }
    console.error(`\nReserved ports:`);
    for (const [k, v] of Object.entries(reg.ports)) {
      console.error(`  ${k}=${v}`);
    }
    console.error(`Shutdown phase: ${reg.shutdownPhase}`);
  }
}

export async function cmdSupervisorRun(loaded: LoadedConfig): Promise<void> {
  const { SupervisorDaemon } = await import("../supervisor/daemon.js");
  const daemon = await SupervisorDaemon.create(loaded);
  await daemon.start();
}

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DockerEnvPortKey } from "../utils/compose-env.js";
import { DEFAULT_DOCKER_ENV_PORTS } from "../utils/compose-env.js";
import { registryPath, supervisorLogsDir } from "./paths.js";
import type { ManagedService, ServiceRegistry, ShutdownPhase } from "./types.js";

export function emptyRegistry(
  projectId: string,
  configDir: string,
  supervisorPid: number,
  supervisorPort: number,
  ports: Record<DockerEnvPortKey, number> = { ...DEFAULT_DOCKER_ENV_PORTS },
): ServiceRegistry {
  return {
    version: 1,
    projectId,
    configDir,
    supervisorPid,
    supervisorPort,
    shutdownPhase: "none",
    updatedAt: new Date().toISOString(),
    ports,
    services: [],
  };
}

export function loadRegistry(configDir: string): ServiceRegistry | null {
  const path = registryPath(configDir);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ServiceRegistry;
  } catch {
    return null;
  }
}

export function saveRegistry(configDir: string, registry: ServiceRegistry): void {
  mkdirSync(supervisorLogsDir(configDir), { recursive: true });
  registry.updatedAt = new Date().toISOString();
  const path = registryPath(configDir);
  const tmp = join(supervisorLogsDir(configDir), `.service-registry.${process.pid}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

export function upsertService(
  registry: ServiceRegistry,
  service: ManagedService,
): ServiceRegistry {
  const idx = registry.services.findIndex((s) => s.name === service.name);
  const services = [...registry.services];
  if (idx >= 0) services[idx] = service;
  else services.push(service);
  return { ...registry, services };
}

export function setShutdownPhase(
  registry: ServiceRegistry,
  phase: ShutdownPhase,
): ServiceRegistry {
  return { ...registry, shutdownPhase: phase };
}

export function touchServiceHeartbeat(
  registry: ServiceRegistry,
  name: string,
  health: ManagedService["health"] = "healthy",
): ServiceRegistry {
  const services = registry.services.map((s) =>
    s.name === name
      ? { ...s, lastHeartbeat: new Date().toISOString(), health, status: "running" as const }
      : s,
  );
  return { ...registry, services };
}

import { existsSync, readFileSync } from "node:fs";
import type { LoadedConfig } from "../config/load.js";
import {
  getComposePublishedHostPorts,
  isPortOwnedByComposeProject,
} from "../utils/compose-published-ports.js";
import {
  buildRunnerOrigin,
  parseDockerEnvPorts,
  persistEnvContent,
  readEnvValue,
  setEnvValueInContent,
  setPortInEnvFile,
  type DockerEnvPortKey,
  type DockerEnvPorts,
} from "../utils/compose-env.js";
import { emitLifecycleEvent } from "./lifecycle-log.js";
import { getPortListener, isPortFree } from "./port-probe.js";
import type { PortConflictInfo } from "./types.js";
import { loadRegistry } from "./service-registry.js";
import { hostRunnerPidPath } from "./paths.js";

const PORT_KEYS: DockerEnvPortKey[] = [
  "WP_PORT",
  "WP_HTTPS_PORT",
  "WPDEV_TERMINAL_PORT",
  "WPDEV_TERMINAL_RUNNER_PORT",
  "WPDEV_HOST_RUNNER_PORT",
];

function parsePid(raw: string): number | null {
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isWpDevMarkerPid(pid: number, configDir: string): boolean {
  const registry = loadRegistry(configDir);
  if (registry?.supervisorPid === pid) return true;
  const hostPidPath = hostRunnerPidPath(configDir);
  if (existsSync(hostPidPath)) {
    const hostPid = parsePid(readFileSync(hostPidPath, "utf8"));
    if (hostPid === pid) return true;
  }
  return false;
}

export type PortValidationResult =
  | { ok: true; ports: DockerEnvPorts }
  | { ok: false; conflicts: PortConflictInfo[] };

export async function validateReservedPorts(
  loaded: LoadedConfig,
  envPath: string,
  options: { strict: boolean; relocate: boolean },
): Promise<PortValidationResult> {
  const envContent = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const ports = parseDockerEnvPorts(envContent);
  const projectPorts = await getComposePublishedHostPorts(loaded);
  const conflicts: PortConflictInfo[] = [];
  const used = new Set<number>();

  const checkPort = async (key: DockerEnvPortKey, port: number): Promise<number> => {
    if (used.has(port)) {
      conflicts.push({
        port,
        key,
        ownedByCompose: false,
        ownedByRegistry: false,
      });
      return port;
    }
    used.add(port);

    if (isPortOwnedByComposeProject(port, projectPorts)) {
      return port;
    }

    const listener = await getPortListener(port);
    if (listener) {
      const ownedByRegistry = isWpDevMarkerPid(listener.pid, loaded.configDir);
      conflicts.push({
        port,
        key,
        ownerPid: listener.pid,
        ownerCommand: listener.command,
        ownedByCompose: false,
        ownedByRegistry,
      });
      return port;
    }

    if (!(await isPortFree(port))) {
      conflicts.push({
        port,
        key,
        ownedByCompose: false,
        ownedByRegistry: false,
      });
    }
    return port;
  };

  for (const key of PORT_KEYS) {
    await checkPort(key, ports[key]);
  }

  if (conflicts.length === 0) {
    return { ok: true, ports };
  }

  if (!options.strict || options.relocate) {
    const next = await relocatePorts(loaded, envPath, ports, projectPorts, used, conflicts);
    emitLifecycleEvent(loaded.configDir, loaded.config.project, "port.reserve", {
      relocated: true,
      ports: next,
    });
    return { ok: true, ports: next };
  }

  for (const c of conflicts) {
    emitLifecycleEvent(loaded.configDir, loaded.config.project, "port.conflict", {
      port: c.port,
      key: c.key,
      ownerPid: c.ownerPid,
    });
  }
  return { ok: false, conflicts };
}

async function relocatePorts(
  loaded: LoadedConfig,
  envPath: string,
  current: DockerEnvPorts,
  projectPorts: Set<number>,
  used: Set<number>,
  conflicts: PortConflictInfo[],
): Promise<DockerEnvPorts> {
  const next = { ...current };
  const conflictedKeys = new Set(conflicts.map((c) => c.key));

  const allocate = async (key: DockerEnvPortKey, startAt: number): Promise<number> => {
    let candidate = startAt;
    while (candidate <= 65535) {
      if (!used.has(candidate)) {
        const owned = isPortOwnedByComposeProject(candidate, projectPorts);
        const free = owned || (await isPortFree(candidate));
        if (free) {
          used.add(candidate);
          return candidate;
        }
      }
      candidate += 1;
    }
    throw new Error(`Could not find a free local TCP port for ${key}`);
  };

  // Only reassign conflicted keys — free ports must stay put.
  for (const key of PORT_KEYS) {
    if (!conflictedKeys.has(key)) continue;
    const allocated = await allocate(key, next[key] + 1);
    setPortInEnvFile(envPath, key, allocated, {
      configDir: loaded.configDir,
      projectId: loaded.config.project,
    });
    next[key] = allocated;
  }

  // P2-6: Update WPDEV_TERMINAL_RUNNER_ORIGIN when WP_PORT or WP_HTTPS_PORT changed.
  // The origin must match the active local URL port for admin save to work.
  if (conflictedKeys.has("WP_PORT") || conflictedKeys.has("WP_HTTPS_PORT")) {
    let envContent = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
    const sslEnabled = /^(1|true|yes)$/i.test(readEnvValue(envContent, "WPDEV_LOCAL_HTTPS") || "");
    const activePort = sslEnabled ? next.WP_HTTPS_PORT : next.WP_PORT;
    const protocol = sslEnabled ? "https" : "http";
    const newOrigin = buildRunnerOrigin(loaded.config.local.url, activePort, protocol);
    envContent = setEnvValueInContent(envContent, "WPDEV_TERMINAL_RUNNER_ORIGIN", newOrigin);
    persistEnvContent(envPath, envContent, loaded);
  }

  return next;
}

/** Keys that would be reassigned by relocate (exported for unit tests). */
export function conflictedPortKeys(conflicts: PortConflictInfo[]): Set<DockerEnvPortKey> {
  return new Set(conflicts.map((c) => c.key));
}

export function formatPortConflicts(conflicts: PortConflictInfo[]): string {
  const lines = conflicts.map((c) => {
    const owner =
      c.ownerPid != null
        ? `PID ${c.ownerPid}${c.ownerCommand ? ` (${c.ownerCommand})` : ""}`
        : "unknown process";
    const tag = c.ownedByRegistry ? " [wp-dev]" : "";
    return `  ${c.key}=${c.port} — in use by ${owner}${tag}`;
  });
  return (
    "Port conflict(s) detected (strict mode — ports are not changed automatically):\n" +
    `${lines.join("\n")}\n\n` +
    "Options:\n" +
    "  wp-dev up --reclaim-ports   Stop orphaned wp-dev listeners and retry\n" +
    "  wp-dev up --relocate-ports  Assign new free ports (updates docker/.env)\n" +
    "  wp-dev supervisor status    Inspect running supervisor\n"
  );
}

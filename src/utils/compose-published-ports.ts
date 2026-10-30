import type { LoadedConfig } from "../config/load.js";
import type { WpDevConfig } from "../config/schema.js";
import { composeRead } from "../services/docker-compose.js";
import { resolveNetworkEnvForCompose } from "./compose-prerequisites.js";

/** Host ports published by `docker compose ps` (this project only). */
export function parseHostPortsFromComposePsJson(stdout: string): Set<number> {
  const ports = new Set<number>();
  for (const line of stdout.trim().split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }

    const publishers = row.Publishers;
    if (Array.isArray(publishers)) {
      for (const pub of publishers) {
        if (pub && typeof pub === "object") {
          const p = pub as { PublishedPort?: number };
          if (typeof p.PublishedPort === "number" && p.PublishedPort > 0) {
            ports.add(p.PublishedPort);
          }
        }
      }
    }

    const portsStr = row.Ports;
    if (typeof portsStr === "string") {
      for (const m of portsStr.matchAll(/(?:^|[\s,])[\d.]*:(\d+)->/g)) {
        const n = Number.parseInt(m[1], 10);
        if (Number.isFinite(n) && n > 0) ports.add(n);
      }
    }
  }
  return ports;
}

/**
 * Get published host ports for a compose project.
 * Uses resolveNetworkEnvForCompose() to work with old .env files.
 */
export async function getComposePublishedHostPorts(
  loaded: LoadedConfig,
): Promise<Set<number>> {
  try {
    const networkEnv = resolveNetworkEnvForCompose(loaded);
    const r = await composeRead(loaded, ["ps", "--format", "json"], networkEnv);
    if (r.exitCode !== 0) return new Set();
    return parseHostPortsFromComposePsJson(r.stdout);
  } catch {
    return new Set();
  }
}

/**
 * @deprecated Use getComposePublishedHostPorts(loaded) instead
 */
export async function getComposePublishedHostPortsLegacy(
  configDir: string,
  config: WpDevConfig,
): Promise<Set<number>> {
  const loaded = { configDir, config } as LoadedConfig;
  return getComposePublishedHostPorts(loaded);
}

/** True when `port` is published by this compose project (already bound by our containers). */
export function isPortOwnedByComposeProject(
  port: number,
  projectPorts: Set<number>,
): boolean {
  return projectPorts.has(port);
}

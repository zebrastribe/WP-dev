import { execa } from "execa";
import type { WpDevConfig } from "../config/schema.js";
import {
  getComposeProjectDir,
  getDockerComposeLeadArgs,
} from "../services/docker-compose.js";

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

export async function getComposePublishedHostPorts(
  configDir: string,
  config: WpDevConfig,
): Promise<Set<number>> {
  const projectDir = getComposeProjectDir(configDir, config);
  try {
    const r = await execa(
      "docker",
      [...getDockerComposeLeadArgs(config), "ps", "--format", "json"],
      { cwd: projectDir, reject: false, stdio: ["ignore", "pipe", "pipe"] },
    );
    if (r.exitCode !== 0) return new Set();
    return parseHostPortsFromComposePsJson(String(r.stdout ?? ""));
  } catch {
    return new Set();
  }
}

/** True when `port` is published by this compose project (already bound by our containers). */
export function isPortOwnedByComposeProject(
  port: number,
  projectPorts: Set<number>,
): boolean {
  return projectPorts.has(port);
}

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { LoadedConfig } from "../config/load.js";
import { writeWpDevConfig } from "../config/load.js";

export type DockerEnvPortKey =
  | "WP_PORT"
  | "WP_HTTPS_PORT"
  | "WPDEV_TERMINAL_PORT"
  | "WPDEV_TERMINAL_RUNNER_PORT"
  | "WPDEV_HOST_RUNNER_PORT";

export type DockerEnvPorts = Record<DockerEnvPortKey, number>;

export const DEFAULT_DOCKER_ENV_PORTS: DockerEnvPorts = {
  WP_PORT: 8888,
  WP_HTTPS_PORT: 8443,
  WPDEV_TERMINAL_PORT: 7681,
  WPDEV_TERMINAL_RUNNER_PORT: 7682,
  WPDEV_HOST_RUNNER_PORT: 7683,
};

export const SECURITY_ENV_KEYS = [
  "WPDEV_ADMIN_SAVE_TOKEN",
  "WPDEV_TERMINAL_AUTH",
  "WPDEV_TERMINAL_RUNNER_TOKEN",
  "WPDEV_TERMINAL_RUNNER_ORIGIN",
] as const;

export function readEnvValue(content: string, key: string): string {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = content.match(new RegExp(`^${escaped}=(.*)$`, "m"));
  if (!m) return "";
  return (m[1] || "").trim();
}

export function setEnvValueInContent(content: string, key: string, value: string): string {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const line = `${key}=${value}`;
  if (new RegExp(`^${escaped}=.*$`, "m").test(content)) {
    return content.replace(new RegExp(`^${escaped}=.*$`, "m"), line);
  }
  const prefix = content.trim().length > 0 ? `${content.replace(/\s*$/, "")}\n` : "";
  return `${prefix}${line}\n`;
}

export function setPortInEnvFile(
  path: string,
  key: DockerEnvPortKey,
  port: number,
): void {
  const line = `${key}=${port}`;
  const current = existsSync(path) ? readFileSync(path, "utf8") : "";
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`^${escaped}=.*$`, "m").test(current)) {
    const next = current.replace(new RegExp(`^${escaped}=.*$`, "m"), line);
    writeFileSync(path, next.endsWith("\n") ? next : `${next}\n`, "utf8");
    return;
  }
  const prefix = current.trim().length > 0 ? `${current.replace(/\s*$/, "")}\n` : "";
  writeFileSync(path, `${prefix}${line}\n`, "utf8");
}

export function setWpPortInEnvFile(path: string, port: number): void {
  setPortInEnvFile(path, "WP_PORT", port);
}

export function parseDockerEnvPorts(envContent: string): DockerEnvPorts {
  const readPort = (key: DockerEnvPortKey, fallback: number): number => {
    const n = Number.parseInt(readEnvValue(envContent, key) || String(fallback), 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    WP_PORT: readPort("WP_PORT", DEFAULT_DOCKER_ENV_PORTS.WP_PORT),
    WP_HTTPS_PORT: readPort("WP_HTTPS_PORT", DEFAULT_DOCKER_ENV_PORTS.WP_HTTPS_PORT),
    WPDEV_TERMINAL_PORT: readPort("WPDEV_TERMINAL_PORT", DEFAULT_DOCKER_ENV_PORTS.WPDEV_TERMINAL_PORT),
    WPDEV_TERMINAL_RUNNER_PORT: readPort(
      "WPDEV_TERMINAL_RUNNER_PORT",
      DEFAULT_DOCKER_ENV_PORTS.WPDEV_TERMINAL_RUNNER_PORT,
    ),
    WPDEV_HOST_RUNNER_PORT: readPort(
      "WPDEV_HOST_RUNNER_PORT",
      DEFAULT_DOCKER_ENV_PORTS.WPDEV_HOST_RUNNER_PORT,
    ),
  };
}

export function extractBoundPort(message: string): number | null {
  const m = message.match(/:(\d+)\s+failed:\s+port is already allocated/i);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function runnerOriginPortMismatch(runnerOrigin: string, wpPort: number): boolean {
  let u: URL;
  try {
    u = new URL(runnerOrigin);
  } catch {
    return true;
  }
  const host = u.hostname.toLowerCase();
  if (host !== "localhost" && host !== "127.0.0.1") return false;
  const currentPort =
    u.port.length > 0 ? Number.parseInt(u.port, 10) : u.protocol === "https:" ? 443 : 80;
  return currentPort !== wpPort;
}

export function maybeUpdateLocalUrlPort(loaded: LoadedConfig, newPort: number): void {
  const raw = loaded.config.local.url;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return;
  }
  const host = u.hostname.toLowerCase();
  const currentPort =
    u.port.length > 0 ? Number.parseInt(u.port, 10) : u.protocol === "https:" ? 443 : 80;
  if ((host === "localhost" || host === "127.0.0.1") && currentPort !== newPort) {
    u.port = String(newPort);
    loaded.config.local.url = u.toString().replace(/\/$/, "");
    writeWpDevConfig(loaded.configDir, loaded.config);
  }
}

export function maybeUpdateRunnerOriginPort(envPath: string, newPort: number): void {
  const current = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const runnerOrigin = readEnvValue(current, "WPDEV_TERMINAL_RUNNER_ORIGIN");
  if (!runnerOrigin) return;
  let u: URL;
  try {
    u = new URL(runnerOrigin);
  } catch {
    return;
  }
  const host = u.hostname.toLowerCase();
  const currentPort =
    u.port.length > 0 ? Number.parseInt(u.port, 10) : u.protocol === "https:" ? 443 : 80;
  if ((host === "localhost" || host === "127.0.0.1") && currentPort !== newPort) {
    u.port = String(newPort);
    const next = setEnvValueInContent(
      current,
      "WPDEV_TERMINAL_RUNNER_ORIGIN",
      u.toString().replace(/\/$/, ""),
    );
    writeFileSync(envPath, next.endsWith("\n") ? next : `${next}\n`, "utf8");
  }
}

export function listSecurityEnvPlaceholderKeys(content: string): string[] {
  return SECURITY_ENV_KEYS.filter((k) => {
    const v = readEnvValue(content, k);
    if (!v) return true;
    return (
      v.includes("change-me") ||
      v === "wpdev:wpdev" ||
      (k === "WPDEV_TERMINAL_RUNNER_ORIGIN" && v.includes("localhost:8888"))
    );
  });
}

export function resolveConflictPortKey(
  conflictPort: number,
  ports: DockerEnvPorts,
): DockerEnvPortKey {
  if (conflictPort === ports.WP_PORT) return "WP_PORT";
  if (conflictPort === ports.WP_HTTPS_PORT) return "WP_HTTPS_PORT";
  if (conflictPort === ports.WPDEV_TERMINAL_PORT) return "WPDEV_TERMINAL_PORT";
  if (conflictPort === ports.WPDEV_TERMINAL_RUNNER_PORT) return "WPDEV_TERMINAL_RUNNER_PORT";
  return "WP_PORT";
}

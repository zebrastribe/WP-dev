import { chmodSync, chownSync, copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import type { LoadedConfig } from "../config/load.js";
import { writeWpDevConfig } from "../config/load.js";
import { fsAuditLog } from "../fs/audit-log.js";
import { resolveHostIdentity } from "./host-paths.js";
import { assertNotSymlink } from "./generated-bind-mounts.js";

/**
 * Default local hostname for wp-dev sites.
 * Single source of truth - used for runner origin fallback and placeholder detection.
 */
export const DEFAULT_LOCAL_HOST = "127.0.0.1";

/**
 * Build a POSIX-portable shell command to replace a symlink with a copy of its target.
 * Works on both GNU/Linux and macOS without requiring GNU coreutils.
 * Properly quotes paths with spaces.
 */
function buildSymlinkCopyCommand(symPath: string): string {
  // Shell-escape the path for use in command
  const escaped = symPath.replace(/'/g, "'\\''");
  // POSIX: cd to containing dir, resolve relative symlink, copy, remove link
  return `target="$(cd "$(dirname '${escaped}')" && pwd -P)/$(readlink '${escaped}')" && ` +
    `cp "$target" '${escaped}.tmp' && rm '${escaped}' && mv '${escaped}.tmp' '${escaped}'`;
}

/**
 * Assert that an .env path is not a symlink. Reuses the shared assertNotSymlink
 * but with a .env-specific error message that tells the user to COPY the file
 * (not regenerate, which would lose tokens).
 */
function assertNotSymlinkEnv(envPath: string): void {
  try {
    assertNotSymlink(envPath, "Docker Compose environment file");
  } catch (e) {
    if (e instanceof Error && e.message.includes("symlink")) {
      const cmd = buildSymlinkCopyCommand(envPath);
      // Rethrow with .env-specific guidance - portable POSIX command
      throw new Error(
        `${envPath} is a symlink. wp-dev cannot write through symlinks. ` +
          `Replace it with a regular copy of the target file to preserve your tokens:\n  ${cmd}`,
      );
    }
    throw e;
  }
}

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

export function writeEnvFile(
  path: string,
  content: string,
  meta?: { configDir: string; projectId: string },
): void {
  // P1: Never write through a symlinked .env - refuse with clear error.
  // Uses shared assertNotSymlink helper with .env-specific error message.
  assertNotSymlinkEnv(path);

  const normalized = content.endsWith("\n") ? content : `${content}\n`;
  // docker/.env is a Docker *file* bind-mount. Atomic rename replaces the host inode
  // while the container keeps the old one (nlink=0), so never rename-replace here.
  if (existsSync(path)) {
    try {
      copyFileSync(path, `${path}.bak`);
    } catch {
      /* non-fatal */
    }
  }
  writeFileSync(path, normalized, { mode: 0o660 });
  if (meta?.configDir && meta.projectId) {
    fsAuditLog(meta.configDir, meta.projectId, "fs.write_atomic", { path });
  }
  // When the CLI runs as root inside the terminal container, keep host:www-data
  // ownership so host CLI + Apache can both read secrets (and UI job polls don't
  // briefly see runner_secrets_unavailable).
  if (meta?.configDir) {
    try {
      const { uid } = resolveHostIdentity(meta.configDir);
      const wwwDataGid = 33;
      chownSync(path, uid, wwwDataGid);
      chmodSync(path, 0o660);
      const bak = `${path}.bak`;
      if (existsSync(bak)) {
        chownSync(bak, uid, wwwDataGid);
        chmodSync(bak, 0o660);
      }
    } catch {
      /* non-root or unsupported platform */
    }
  }
}

export function persistEnvContent(
  path: string,
  content: string,
  loaded?: { configDir: string; config: { project: string } },
): void {
  writeEnvFile(
    path,
    content,
    loaded ? { configDir: loaded.configDir, projectId: loaded.config.project } : undefined,
  );
}

export function setPortInEnvFile(
  path: string,
  key: DockerEnvPortKey,
  port: number,
  meta?: { configDir: string; projectId: string },
): void {
  const line = `${key}=${port}`;
  const current = existsSync(path) ? readFileSync(path, "utf8") : "";
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let next: string;
  if (new RegExp(`^${escaped}=.*$`, "m").test(current)) {
    next = current.replace(new RegExp(`^${escaped}=.*$`, "m"), line);
  } else {
    const prefix = current.trim().length > 0 ? `${current.replace(/\s*$/, "")}\n` : "";
    next = `${prefix}${line}\n`;
  }
  writeEnvFile(path, next, meta);
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

/**
 * Check if runner origin port mismatches WP_PORT.
 * Only applies to localhost origins (using DEFAULT_LOCAL_HOST or common aliases).
 */
export function runnerOriginPortMismatch(runnerOrigin: string, wpPort: number): boolean {
  let u: URL;
  try {
    u = new URL(runnerOrigin);
  } catch {
    return true;
  }
  const host = u.hostname.toLowerCase();
  // Check against DEFAULT_LOCAL_HOST and common localhost aliases
  const localhostAliases = [DEFAULT_LOCAL_HOST, "localhost", "127.0.0.1"];
  if (!localhostAliases.includes(host)) return false;
  const currentPort =
    u.port.length > 0 ? Number.parseInt(u.port, 10) : u.protocol === "https:" ? 443 : 80;
  return currentPort !== wpPort;
}

/**
 * Build the terminal runner origin URL from local.url.
 * This is the SINGLE source of truth for runner origin construction.
 *
 * @param localUrl - The local.url from config (e.g., "http://localhost:8888")
 * @param overridePort - Optional port override (used when relocating ports)
 * @param overrideProtocol - Optional protocol override ("http" or "https")
 */
export function buildRunnerOrigin(
  localUrl: string,
  overridePort?: number,
  overrideProtocol?: "http" | "https",
): string {
  let u: URL;
  try {
    u = new URL(localUrl);
  } catch {
    // Fallback if localUrl is malformed - use single source of truth for host/port
    const port = overridePort ?? DEFAULT_DOCKER_ENV_PORTS.WP_PORT;
    const protocol = overrideProtocol ?? "http";
    return `${protocol}://${DEFAULT_LOCAL_HOST}:${port}`;
  }

  const protocol = overrideProtocol ?? (u.protocol === "https:" ? "https" : "http");
  const host = u.hostname;
  const port = overridePort ?? (u.port ? Number.parseInt(u.port, 10) : (protocol === "https" ? 443 : 80));

  return `${protocol}://${host}:${port}`;
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

export function maybeUpdateRunnerOriginPort(
  envPath: string,
  newPort: number,
  meta?: { configDir: string; projectId: string },
): void {
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
    writeEnvFile(envPath, next, meta);
  }
}

export function listSecurityEnvPlaceholderKeys(content: string): string[] {
  // Detect placeholder runner origin by checking for default host:port combinations
  // Uses single source of truth: DEFAULT_LOCAL_HOST and DEFAULT_DOCKER_ENV_PORTS.WP_PORT
  const defaultPort = DEFAULT_DOCKER_ENV_PORTS.WP_PORT;
  const placeholderPatterns = [
    `${DEFAULT_LOCAL_HOST}:${defaultPort}`,
    `localhost:${defaultPort}`,
    `127.0.0.1:${defaultPort}`,
  ];

  return SECURITY_ENV_KEYS.filter((k) => {
    const v = readEnvValue(content, k);
    if (!v) return true;
    if (v.includes("change-me") || v === "wpdev:wpdev") return true;
    if (k === "WPDEV_TERMINAL_RUNNER_ORIGIN") {
      return placeholderPatterns.some((p) => v.includes(p));
    }
    return false;
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

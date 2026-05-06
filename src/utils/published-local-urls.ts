import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { LoadedConfig } from "../config/load.js";

/** Path to `docker/.env` (Compose env) for this project. */
export function dockerComposeEnvPath(loaded: LoadedConfig): string {
  return join(loaded.configDir, loaded.config.local.path, ".env");
}

/** Reads `WP_PORT` from `docker/.env` when present. */
export function readWpPortFromDockerEnvFile(envFilePath: string): number | undefined {
  if (!existsSync(envFilePath)) return undefined;
  const text = readFileSync(envFilePath, "utf8");
  const m = text.match(/^\s*WP_PORT\s*=\s*"?(\d+)"?\s*$/m);
  if (!m) return undefined;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Reads `WP_HTTPS_PORT` from `docker/.env` when present. */
export function readWpHttpsPortFromDockerEnvFile(envFilePath: string): number | undefined {
  if (!existsSync(envFilePath)) return undefined;
  const text = readFileSync(envFilePath, "utf8");
  const m = text.match(/^\s*WP_HTTPS_PORT\s*=\s*"?(\d+)"?\s*$/m);
  if (!m) return undefined;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export type PublishedLocalAccess = {
  site: string;
  admin: string;
  warnings: string[];
};

export function getLocalUrlPortMismatch(
  loaded: LoadedConfig,
): { localUrlPort: number; wpPort: number } | undefined {
  const envPath = dockerComposeEnvPath(loaded);
  const wpPort = readWpPortFromDockerEnvFile(envPath);
  if (wpPort == null) return undefined;
  try {
    const u = new URL(loaded.config.local.url);
    const host = u.hostname.toLowerCase();
    const isLoopback =
      host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
    if (!isLoopback) return undefined;
    const localUrlPort = u.port
      ? Number.parseInt(u.port, 10)
      : u.protocol === "https:"
        ? 443
        : 80;
    if (localUrlPort === wpPort) return undefined;
    return { localUrlPort, wpPort };
  } catch {
    return undefined;
  }
}

/**
 * URLs to open in the browser for this clone. Prefer `docker/.env` `WP_PORT` over a stale
 * `local.url` port when both refer to loopback — Docker publishes `WP_PORT` on the host.
 */
export function getPublishedLocalAccess(loaded: LoadedConfig): PublishedLocalAccess {
  const warnings: string[] = [];
  const envPath = dockerComposeEnvPath(loaded);
  const wpPort = readWpPortFromDockerEnvFile(envPath);
  const wpHttpsPort = readWpHttpsPortFromDockerEnvFile(envPath);
  let site = loaded.config.local.url;

  try {
    const u = new URL(site);
    const host = u.hostname.toLowerCase();
    const isLoopback =
      host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
    const urlPort = u.port
      ? Number.parseInt(u.port, 10)
      : u.protocol === "https:"
        ? 443
        : 80;

    const isHttps = u.protocol === "https:";
    const expectedPort = isHttps ? wpHttpsPort : wpPort;
    const expectedLabel = isHttps ? "WP_HTTPS_PORT" : "WP_PORT";
    if (isLoopback && expectedPort != null && urlPort !== expectedPort) {
      warnings.push(
        `local.url uses port ${urlPort} but docker/.env has ${expectedLabel}=${expectedPort}. Browser URLs below use ${expectedLabel} (what Docker publishes). Update local.url (wizard or file) to match.`,
      );
      u.protocol = isHttps ? "https:" : "http:";
      u.hostname = "localhost";
      u.port = String(expectedPort);
      site = u.toString().replace(/\/$/, "");
    }
  } catch {
    if (wpPort != null) {
      site = `http://localhost:${wpPort}`;
      warnings.push("local.url is not a valid URL; showing http://localhost:<WP_PORT> from docker/.env.");
    }
  }

  let admin: string;
  try {
    const baseForUrl = site.endsWith("/") ? site : `${site}/`;
    admin = new URL("admin/", baseForUrl).toString();
  } catch {
    admin = `${site.replace(/\/?$/, "")}/admin/`;
  }

  return { site, admin, warnings };
}

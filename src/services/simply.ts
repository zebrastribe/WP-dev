import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { WpDevConfig } from "../config/schema.js";
import { getComposeProjectDir } from "./docker-compose.js";

const API_BASE = "https://api.simply.com/2";

/** Env var for Simply.com API key (HTTP Basic password). See https://www.simply.com/en/docs/api/ */
export const SIMPLY_API_KEY_ENV = "WPDEV_SIMPLY_API_KEY";
export const STAGING_DB_HOST_ENV = "WPDEV_STAGING_DB_HOST";
export const STAGING_DB_NAME_ENV = "WPDEV_STAGING_DB_NAME";
export const STAGING_DB_USER_ENV = "WPDEV_STAGING_DB_USER";
export const STAGING_DB_PASSWORD_ENV = "WPDEV_STAGING_DB_PASSWORD";
export const STAGING_DB_PREFIX_ENV = "WPDEV_STAGING_DB_PREFIX";

export function readDotenvKeyFromFile(filePath: string, key: string): string | undefined {
  if (!existsSync(filePath)) return undefined;
  const text = readFileSync(filePath, "utf8");
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = text.match(new RegExp(`^${escapedKey}=(.*)$`, "m"));
  if (!m?.[1]) return undefined;
  let v = m[1].trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1);
  }
  return v.trim() !== "" ? v.trim() : undefined;
}

/**
 * If `WPDEV_SIMPLY_API_KEY` is not already set, read it from `docker/.env` (same file Compose uses).
 * Called at CLI startup so `simply` / `pull` / `doctor` pick up keys saved from the admin UI.
 */
export function hydrateSimplyApiKeyFromComposeEnv(
  configDir: string,
  config: WpDevConfig,
): void {
  if (process.env[SIMPLY_API_KEY_ENV]?.trim()) return;
  const envPath = join(getComposeProjectDir(configDir, config), ".env");
  const v = readDotenvKeyFromFile(envPath, SIMPLY_API_KEY_ENV);
  if (v) process.env[SIMPLY_API_KEY_ENV] = v;
}

/** Hydrate optional staging.db credentials from docker/.env (gitignored local file). */
export function hydrateStagingDbFromComposeEnv(
  configDir: string,
  config: WpDevConfig,
): void {
  const envPath = join(getComposeProjectDir(configDir, config), ".env");
  const host = readDotenvKeyFromFile(envPath, STAGING_DB_HOST_ENV)?.trim();
  const name = readDotenvKeyFromFile(envPath, STAGING_DB_NAME_ENV)?.trim();
  const user = readDotenvKeyFromFile(envPath, STAGING_DB_USER_ENV)?.trim();
  const password = readDotenvKeyFromFile(envPath, STAGING_DB_PASSWORD_ENV)?.trim();
  const prefix = readDotenvKeyFromFile(envPath, STAGING_DB_PREFIX_ENV)?.trim();
  if (!host || !name || !user || !password) return;
  config.staging.db = {
    host,
    name,
    user,
    password,
    ...(prefix ? { prefix } : {}),
  };
}

export function getSimplyApiKey(): string | undefined {
  const v = process.env[SIMPLY_API_KEY_ENV];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

export function assertSimplyConfigured(config: WpDevConfig): {
  account: string;
  apiKey: string;
} {
  if (!config.simply) {
    throw new Error(
      `Add a "simply" block with "account" (e.g. S123456 or UE12345) to wp-dev.config.json, and set ${SIMPLY_API_KEY_ENV} to your Simply.com API key.`,
    );
  }
  const apiKey = getSimplyApiKey();
  if (!apiKey) {
    throw new Error(
      `Set ${SIMPLY_API_KEY_ENV} in your shell, in docker/.env, or save it from the wp-dev admin wizard (Simply step).`,
    );
  }
  return { account: config.simply.account, apiKey };
}

/** GET path starting with `/` (e.g. `/my/products/`). */
export async function simplyGet(
  config: WpDevConfig,
  path: string,
): Promise<{ status: number; body: string }> {
  const { account, apiKey } = assertSimplyConfigured(config);
  const url = `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  const auth = Buffer.from(`${account}:${apiKey}`, "utf8").toString("base64");
  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
    },
  });
  const body = await res.text();
  return { status: res.status, body };
}

/** GET and parse JSON; throws on non-2xx or invalid JSON. */
export async function simplyGetJson(config: WpDevConfig, path: string): Promise<unknown> {
  const { status, body } = await simplyGet(config, path);
  if (status < 200 || status >= 300) {
    throw new Error(`Simply API HTTP ${status}: ${body.slice(0, 400)}`);
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error(`Simply API: expected JSON (${status}): ${body.slice(0, 240)}`);
  }
}

/** POST JSON body; throws on non-2xx or invalid JSON. */
export async function simplyPostJson(
  config: WpDevConfig,
  path: string,
  jsonBody: unknown,
): Promise<unknown> {
  const { account, apiKey } = assertSimplyConfigured(config);
  const url = `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  const auth = Buffer.from(`${account}:${apiKey}`, "utf8").toString("base64");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(jsonBody),
  });
  const body = await res.text();
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Simply API HTTP ${res.status}: ${body.slice(0, 400)}`);
  }
  try {
    return body === "" ? {} : (JSON.parse(body) as unknown);
  } catch {
    throw new Error(`Simply API: expected JSON (${res.status}): ${body.slice(0, 240)}`);
  }
}

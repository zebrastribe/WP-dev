import type { WpDevConfig } from "../config/schema.js";

const API_BASE = "https://api.simply.com/2";

/** Env var for Simply.com API key (HTTP Basic password). See https://www.simply.com/en/docs/api/ */
export const SIMPLY_API_KEY_ENV = "WPDEV_SIMPLY_API_KEY";

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
      `Add a "simply" block with "account" (e.g. S123456 or UE84785) to wp-dev.config.json, and set ${SIMPLY_API_KEY_ENV} to your API key.`,
    );
  }
  const apiKey = getSimplyApiKey();
  if (!apiKey) {
    throw new Error(
      `Set environment variable ${SIMPLY_API_KEY_ENV} to your Simply.com API key (Control Panel).`,
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

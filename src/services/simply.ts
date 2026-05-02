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
      `Add a "simply" block with "account" (e.g. S123456) to wp-dev.config.json, and set ${SIMPLY_API_KEY_ENV} to your API key.`,
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

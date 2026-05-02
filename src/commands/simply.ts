import type { LoadedConfig } from "../config/load.js";
import { simplyGet } from "../services/simply.js";
import { logInfo } from "../utils/logger.js";

export async function cmdSimplyTest(loaded: LoadedConfig): Promise<void> {
  logInfo("simply test: GET /my/products/");
  const { status, body } = await simplyGet(loaded.config, "/my/products/");
  if (status < 200 || status >= 300) {
    throw new Error(
      `Simply.com API returned HTTP ${status}. Body (truncated): ${body.slice(0, 500)}`,
    );
  }
  console.error(`Simply.com API OK (HTTP ${status}). Response starts with:\n${body.slice(0, 400)}${body.length > 400 ? "…" : ""}`);
}

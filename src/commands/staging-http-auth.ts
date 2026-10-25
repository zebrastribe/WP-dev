import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LoadedConfig } from "../config/load.js";
import type { WpDevConfig } from "../config/schema.js";
import {
  applyStagingHttpAuthOnRemote,
  defaultStagingHttpAuth,
  maskSecret,
  type StagingHttpAuthConfig,
} from "../services/staging-http-auth.js";

export type StagingHttpAuthAction = "enable" | "disable" | "show" | "apply";

function persistConfig(loaded: LoadedConfig, config: WpDevConfig): void {
  const path = join(loaded.configDir, "wp-dev.config.json");
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  console.log(`Updated ${path} (staging.httpAuth)`);
}

function withHttpAuth(config: WpDevConfig, auth: StagingHttpAuthConfig): WpDevConfig {
  return { ...config, staging: { ...config.staging, httpAuth: auth } };
}

export async function cmdStagingHttpAuth(
  loaded: LoadedConfig,
  action: StagingHttpAuthAction,
): Promise<void> {
  const config = loaded.config;
  const existing = config.staging.httpAuth;

  if (action === "show") {
    if (!existing) {
      throw new Error("staging.httpAuth is not set — run: wp-dev staging-http-auth enable");
    }
    console.log(`staging HTTP auth: ${existing.enabled ? "on" : "off"}`);
    console.log(`username: ${existing.username}`);
    console.log(`password: ${maskSecret(existing.password)}`);
    console.log(`site: ${config.staging.url}`);
    return;
  }

  let auth: StagingHttpAuthConfig;
  if (action === "disable") {
    auth = {
      enabled: false,
      username: existing?.username?.trim() || "staging",
      password: existing?.password || "n/a",
    };
  } else if (existing?.username?.trim() && existing.password) {
    auth = { enabled: true, username: existing.username.trim(), password: existing.password };
  } else {
    auth = defaultStagingHttpAuth();
  }

  const next = withHttpAuth(config, auth);
  persistConfig(loaded, next);

  const result = await applyStagingHttpAuthOnRemote(next, {
    ...auth,
    enabled: action !== "disable",
  });

  if (result.enabled) {
    console.log(`Staging HTTP auth applied for user "${result.username}"`);
    console.log(`  username: ${auth.username}`);
    console.log(`  password: ${maskSecret(auth.password)} (full value in wp-dev.config.json)`);
    console.log(`  .htpasswd → ${result.htpasswdPath}`);
    console.log(`Browse ${next.staging.url} — browser will prompt for these credentials.`);
  } else {
    console.log("Staging HTTP auth removed from remote .htaccess / .htpasswd");
  }
}

import { execa } from "execa";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { LoadedConfig } from "../config/load.js";
import { writeWpDevConfig } from "../config/load.js";
import { buildRunnerOrigin, DEFAULT_DOCKER_ENV_PORTS, persistEnvContent, setEnvValueInContent } from "../utils/compose-env.js";

function readEnvValue(content: string, key: string): string {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = content.match(new RegExp(`^${escaped}=(.*)$`, "m"));
  if (!m) return "";
  return (m[1] || "").trim();
}

function setEnvValue(content: string, key: string, value: string): string {
  return setEnvValueInContent(content, key, value);
}

function composeEnvPath(loaded: LoadedConfig): string {
  return join(loaded.configDir, loaded.config.local.path, ".env");
}

async function ensureMkcertCertificate(certFile: string, keyFile: string): Promise<void> {
  try {
    await execa("mkcert", ["-help"], { stdio: "pipe" });
  } catch {
    throw new Error(
      "mkcert is required for localhost SSL. Install mkcert and run `mkcert -install` first.",
    );
  }
  await execa(
    "mkcert",
    ["-cert-file", certFile, "-key-file", keyFile, "localhost", "127.0.0.1", "::1"],
    { stdio: "inherit" },
  );
}

export async function cmdSslEnable(loaded: LoadedConfig): Promise<void> {
  const envPath = composeEnvPath(loaded);
  const current = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const defaultWpPort = DEFAULT_DOCKER_ENV_PORTS.WP_PORT;
  const defaultHttpsPort = DEFAULT_DOCKER_ENV_PORTS.WP_HTTPS_PORT;
  const wpPort = Number.parseInt(readEnvValue(current, "WP_PORT") || String(defaultWpPort), 10);
  const httpsPort = Number.parseInt(readEnvValue(current, "WP_HTTPS_PORT") || String(defaultHttpsPort), 10);
  const safeWpPort = Number.isFinite(wpPort) && wpPort > 0 ? wpPort : defaultWpPort;
  const safeHttpsPort = Number.isFinite(httpsPort) && httpsPort > 0 ? httpsPort : defaultHttpsPort;

  const certDir = join(loaded.configDir, loaded.config.local.path, "certs");
  const certFile = join(certDir, "localhost.pem");
  const keyFile = join(certDir, "localhost-key.pem");
  mkdirSync(certDir, { recursive: true });
  await ensureMkcertCertificate(certFile, keyFile);

  let next = current;
  next = setEnvValue(next, "WPDEV_LOCAL_HTTPS", "1");
  next = setEnvValue(next, "WP_HTTPS_PORT", String(safeHttpsPort));
  // Update local.url first, then derive runner origin from it
  loaded.config.local.url = `https://localhost:${safeHttpsPort}`;
  next = setEnvValue(next, "WPDEV_TERMINAL_RUNNER_ORIGIN", buildRunnerOrigin(loaded.config.local.url));
  persistEnvContent(envPath, next, loaded);
  writeWpDevConfig(loaded.configDir, loaded.config);

  console.error(
    `Local HTTPS enabled.\n` +
      `- Site URL: https://localhost:${safeHttpsPort}\n` +
      `- HTTP URL still available: http://localhost:${safeWpPort}\n` +
      `Run: npm run wp-dev -- down && npm run wp-dev -- up`,
  );
}

export async function cmdSslDisable(loaded: LoadedConfig): Promise<void> {
  const envPath = composeEnvPath(loaded);
  const current = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const defaultWpPort = DEFAULT_DOCKER_ENV_PORTS.WP_PORT;
  const wpPort = Number.parseInt(readEnvValue(current, "WP_PORT") || String(defaultWpPort), 10);
  const safeWpPort = Number.isFinite(wpPort) && wpPort > 0 ? wpPort : defaultWpPort;

  let next = current;
  next = setEnvValue(next, "WPDEV_LOCAL_HTTPS", "0");
  // Update local.url first, then derive runner origin from it
  loaded.config.local.url = `http://localhost:${safeWpPort}`;
  next = setEnvValue(next, "WPDEV_TERMINAL_RUNNER_ORIGIN", buildRunnerOrigin(loaded.config.local.url));
  persistEnvContent(envPath, next, loaded);
  writeWpDevConfig(loaded.configDir, loaded.config);

  console.error(
    `Local HTTPS disabled.\n` +
      `- Site URL: http://localhost:${safeWpPort}\n` +
      `Run: npm run wp-dev -- down && npm run wp-dev -- up`,
  );
}

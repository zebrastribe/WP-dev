import { execa } from "execa";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { LoadedConfig } from "../config/load.js";
import { persistEnvContent, setEnvValueInContent } from "../utils/compose-env.js";

const SUPPORTED_PHP_VERSIONS = ["7.4", "8.0", "8.1", "8.2", "8.3", "8.4"] as const;
type SupportedPhpVersion = (typeof SUPPORTED_PHP_VERSIONS)[number];

function composeEnvPath(loaded: LoadedConfig): string {
  return join(loaded.configDir, loaded.config.local.path, ".env");
}

function readEnvValue(content: string, key: string): string {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = content.match(new RegExp(`^${escaped}=(.*)$`, "m"));
  if (!m) return "";
  return (m[1] || "").trim();
}

function setEnvValue(content: string, key: string, value: string): string {
  return setEnvValueInContent(content, key, value);
}

function assertSupported(version: string): asserts version is SupportedPhpVersion {
  if (!SUPPORTED_PHP_VERSIONS.includes(version as SupportedPhpVersion)) {
    throw new Error(
      `Unsupported PHP version "${version}". Allowed: ${SUPPORTED_PHP_VERSIONS.join(", ")}`,
    );
  }
}

async function assertDockerTagExists(tag: string): Promise<void> {
  try {
    await execa("docker", ["manifest", "inspect", tag], { stdio: "pipe" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Docker image tag not available: ${tag}\n${msg}`);
  }
}

export async function cmdPhpValidate(_loaded: LoadedConfig, version: string): Promise<void> {
  assertSupported(version);
  const wpTag = `wordpress:php${version}-apache`;
  const cliTag = `wordpress:cli-php${version}`;
  await assertDockerTagExists(wpTag);
  await assertDockerTagExists(cliTag);
  console.error(`PHP ${version} is valid for local use.`);
  console.error(`- ${wpTag}`);
  console.error(`- ${cliTag}`);
}

export async function cmdPhpSet(loaded: LoadedConfig, version: string): Promise<void> {
  await cmdPhpValidate(loaded, version);
  const envPath = composeEnvPath(loaded);
  const current = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const next = setEnvValue(current, "WPDEV_PHP_VERSION", version);
  persistEnvContent(envPath, next, loaded);
  console.error(`Set WPDEV_PHP_VERSION=${version} in ${envPath}.`);
  console.error("Run: npm run wp-dev -- down && npm run wp-dev -- up");
}

export async function cmdPhpShow(loaded: LoadedConfig): Promise<void> {
  const envPath = composeEnvPath(loaded);
  const current = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const version = readEnvValue(current, "WPDEV_PHP_VERSION") || "8.2";
  console.error(`Current local PHP version: ${version}`);
  console.error(`Allowed values: ${SUPPORTED_PHP_VERSIONS.join(", ")}`);
}

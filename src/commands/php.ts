import type { LoadedConfig } from "../config/load.js";
import type { RemoteEnvName } from "../config/schema.js";
import {
  assertLocalDockerTags,
  assertSupportedPhpVersion,
  detectPhp,
  type PhpEnvTarget,
  readPhpRollback,
  rollbackPhpVersion,
  setLocalPhpVersion,
  setRemotePhpVersion,
  SUPPORTED_PHP_VERSIONS,
} from "../services/php-version.js";
import { confirmProduction } from "../utils/confirm.js";

export type PhpCommandOptions = {
  env?: PhpEnvTarget;
  restart?: boolean;
  yes?: boolean;
};

function resolveEnv(options: PhpCommandOptions): PhpEnvTarget {
  return options.env ?? "local";
}

export async function cmdPhpValidate(
  _loaded: LoadedConfig,
  version: string,
  options: PhpCommandOptions = {},
): Promise<void> {
  assertSupportedPhpVersion(version);
  const env = resolveEnv(options);
  if (env === "local") {
    await assertLocalDockerTags(version);
    console.error(`PHP ${version} is valid for local Docker use.`);
    console.error(`- wordpress:php${version}-apache`);
    console.error(`- wordpress:cli-php${version}`);
    return;
  }
  const detect = await detectPhp(_loaded, env);
  console.error(`Remote ${env}: strategy=${detect.strategy} supported=${detect.supported}`);
  console.error(detect.detail);
  if (!detect.supported) {
    throw new Error(`Host does not support automated PHP changes for ${env}.`);
  }
  console.error(`PHP ${version} is in the allowed list (${SUPPORTED_PHP_VERSIONS.join(", ")}).`);
}

export async function cmdPhpShow(
  loaded: LoadedConfig,
  options: PhpCommandOptions = {},
): Promise<void> {
  const env = resolveEnv(options);
  const detect = await detectPhp(loaded, env);
  console.error(`Environment: ${env}`);
  console.error(`Current PHP (best effort): ${detect.currentVersion ?? "unknown"}`);
  console.error(`Change strategy: ${detect.strategy}${detect.supported ? "" : " (manual panel only)"}`);
  console.error(`Detail: ${detect.detail}`);
  console.error(`Allowed values: ${SUPPORTED_PHP_VERSIONS.join(", ")}`);
  const rb = readPhpRollback(loaded.configDir, env);
  if (rb) {
    console.error(
      `Rollback available → ${rb.previousVersion ?? "prior files"} (saved ${rb.at}). Run: wp-dev php rollback --env ${env}`,
    );
  }
}

export async function cmdPhpSet(
  loaded: LoadedConfig,
  version: string,
  options: PhpCommandOptions = {},
): Promise<void> {
  assertSupportedPhpVersion(version);
  const env = resolveEnv(options);

  if (env === "production" && !options.yes && process.env.WPDEV_ASSUME_YES !== "1") {
    const ok = await confirmProduction(
      `You are about to change PRODUCTION PHP to ${version}.`,
    );
    if (!ok) {
      console.error("Aborted.");
      process.exitCode = 1;
      return;
    }
  }

  if (env === "local") {
    await setLocalPhpVersion(loaded, version, { restart: Boolean(options.restart) });
    return;
  }

  await setRemotePhpVersion(loaded, env as RemoteEnvName, version);
}

export async function cmdPhpRollback(
  loaded: LoadedConfig,
  options: PhpCommandOptions = {},
): Promise<void> {
  const env = resolveEnv(options);
  if (env === "production" && !options.yes && process.env.WPDEV_ASSUME_YES !== "1") {
    const ok = await confirmProduction("You are about to ROLL BACK PRODUCTION PHP selector files.");
    if (!ok) {
      console.error("Aborted.");
      process.exitCode = 1;
      return;
    }
  }
  await rollbackPhpVersion(loaded, env, { restart: Boolean(options.restart) });
}

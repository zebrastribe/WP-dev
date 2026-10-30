import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { LoadedConfig } from "../config/load.js";
import { detectUnknownConfigKeys } from "../config/load.js";
import { getRemoteEnv, type RemoteEnvName } from "../config/schema.js";
import { connectSsh } from "../services/ssh.js";
import { assertRemoteWpInstalled } from "../services/wpcli.js";
import { assertDockerReady } from "../utils/docker-prereq.js";
import { isPlaceholderRemoteHost } from "../utils/remote-placeholder.js";
import { getLocalUrlPortMismatch } from "../utils/published-local-urls.js";
import { assertHostSyncTools } from "../utils/host-prereq.js";
import { isMacOs } from "../utils/platform-hints.js";
import { logInfo, logWarn } from "../utils/logger.js";

export type ValidateOptions = {
  /** When set, also verify SSH + wp core is-installed for one remote env. */
  remote?: RemoteEnvName;
};

export async function cmdValidate(
  loaded: LoadedConfig,
  options: ValidateOptions = {},
): Promise<void> {
  const { config, configDir } = loaded;
  const issues: string[] = [];
  const warnings: string[] = [];

  // Check for unknown config keys (possible typos)
  try {
    const configPath = join(configDir, "wp-dev.config.json");
    const raw = JSON.parse(readFileSync(configPath, "utf8"));
    const unknownKeys = detectUnknownConfigKeys(raw);
    if (unknownKeys.length > 0) {
      warnings.push(
        `Unknown config keys (possible typos): ${unknownKeys.join(", ")}`,
      );
    }
  } catch {
    // Config was already validated by loadConfig, so this shouldn't happen
  }

  try {
    assertDockerReady();
  } catch (e) {
    issues.push(e instanceof Error ? e.message : String(e));
  }

  const portMismatch = getLocalUrlPortMismatch(loaded);
  if (portMismatch) {
    issues.push(
      `local.url port ${portMismatch.localUrlPort} does not match docker/.env WP_PORT=${portMismatch.wpPort}`,
    );
  }

  if (!config.project.trim()) issues.push("project id is empty");
  if (!config.local.url.trim()) issues.push("local.url is empty");
  if (!config.local.wpRoot.trim()) issues.push("local.wpRoot is empty");

  for (const env of ["staging", "production"] as const) {
    const remote = getRemoteEnv(config, env);
    if (isPlaceholderRemoteHost(remote.host)) continue;
    if (!remote.host.trim() || !remote.user.trim() || !remote.path.trim() || !remote.url.trim()) {
      issues.push(`${env}: incomplete SSH/url fields`);
    }
  }

  try {
    assertHostSyncTools();
  } catch (e) {
    issues.push(e instanceof Error ? e.message : String(e));
  }

  if (isMacOs()) {
    logInfo("validate: running on macOS (Docker Desktop + built-in ssh/rsync)");
  }

  if (options.remote) {
    const remote = getRemoteEnv(config, options.remote);
    if (isPlaceholderRemoteHost(remote.host)) {
      issues.push(`${options.remote}: placeholder host — configure a real server first`);
    } else {
      logInfo(`validate: checking SSH + wp on ${options.remote}`);
      const ssh = await connectSsh(remote);
      try {
        await assertRemoteWpInstalled(ssh, remote.path);
      } catch (e) {
        issues.push(
          `${options.remote}: ${e instanceof Error ? e.message : String(e)}`,
        );
      } finally {
        ssh.dispose();
      }
    }
  }

  // Print warnings (non-fatal)
  if (warnings.length > 0) {
    console.error("Warnings:");
    for (const w of warnings) {
      console.error(`  ⚠ ${w}`);
      logWarn(`validate: ${w}`);
    }
  }

  if (issues.length > 0) {
    console.error("Validation failed:");
    for (const i of issues) console.error(`  - ${i}`);
    throw new Error(`${issues.length} validation issue(s)`);
  }

  console.error("Validation OK.");
  if (options.remote) {
    console.error(`Remote ${options.remote}: SSH and WordPress reachable.`);
  }
}

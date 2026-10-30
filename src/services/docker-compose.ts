import { execa } from "execa";
import { join } from "node:path";
import type { WpDevConfig } from "../config/schema.js";
import type { LoadedConfig } from "../config/load.js";
import { resolveFromConfigDir } from "../config/load.js";
import {
  resolveHostHome,
  resolveHostIdentity,
  resolveHostProjectRoot,
} from "../utils/host-paths.js";

/** Stable Docker Compose project id so each clone gets its own containers/volumes. */
export function dockerComposeProjectId(config: WpDevConfig): string {
  const raw = config.local.composeProjectName ?? config.project;
  const s = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return s.length > 0 ? s : "wp-dev-site";
}

/** Prefix: `docker compose -p <id> -f <composeFile>`. */
export function getDockerComposeLeadArgs(config: WpDevConfig): string[] {
  return [
    "compose",
    "-p",
    dockerComposeProjectId(config),
    "-f",
    config.local.composeFile,
  ];
}

export function getComposeProjectDir(
  configDir: string,
  config: WpDevConfig,
): string {
  return resolveFromConfigDir(configDir, config.local.path);
}

export function getComposeFilePath(
  configDir: string,
  config: WpDevConfig,
): string {
  return join(getComposeProjectDir(configDir, config), config.local.composeFile);
}

export interface ComposeOptions {
  stdio?: "inherit" | "pipe";
  /** Additional env vars to pass to compose (merged with process.env, without mutating it) */
  env?: Record<string, string>;
}

/**
 * Keys where shell-exported values are allowed to win over computed defaults.
 * LIMITED to network vars - host path vars (PROJECT_ROOT, HOME, UID, GID) must
 * always go through validation in resolveHostProjectRoot/resolveHostHome/resolveHostIdentity
 * to reject /workspace, /root, relative paths, etc.
 */
const SHELL_PRECEDENCE_KEYS = new Set([
  "WPDEV_NETWORK_SUBNET",
  "WPDEV_NETWORK_GATEWAY",
  "WPDEV_SSL_PROXY_IP",
  "WPDEV_ADMIN_TRUSTED_GATEWAY",
  "WPDEV_NETWORK_IP_RANGE",
]);

/**
 * Build the env object for compose calls, respecting precedence:
 * 
 * For NETWORK vars (WPDEV_NETWORK_SUBNET, etc.):
 *   1. Shell-exported values (process.env) win over options.env
 *   2. options.env provides fallbacks for missing values
 * 
 * For HOST PATH vars (WPDEV_HOST_PROJECT_ROOT, HOME, UID, GID):
 *   ALWAYS computed via resolveHostProjectRoot/resolveHostHome/resolveHostIdentity
 *   which validate and reject /workspace, /root, relative paths, etc.
 *   Shell exports do NOT bypass this validation.
 */
export function buildComposeEnv(
  configDir: string,
  options: ComposeOptions = {},
): Record<string, string | undefined> {
  const composeEnvPath = join(configDir, ".env");
  
  // ALWAYS compute host paths through validation functions
  // These reject /workspace, /root, relative paths even if shell-exported
  const hostProjectRoot = resolveHostProjectRoot(configDir, composeEnvPath);
  const hostHome = resolveHostHome(composeEnvPath);
  const hostId = resolveHostIdentity(configDir);
  const hostUid = String(hostId.uid);
  const hostGid = String(hostId.gid);

  // Base env from process.env
  const base: Record<string, string | undefined> = { ...process.env };

  // ALWAYS set host paths from validated functions (not shell precedence)
  base.WPDEV_HOST_PROJECT_ROOT = hostProjectRoot;
  base.WPDEV_HOST_HOME = hostHome;
  base.WPDEV_HOST_UID = hostUid;
  base.WPDEV_HOST_GID = hostGid;

  // Add options.env - shell precedence ONLY for network vars
  if (options.env) {
    for (const [key, value] of Object.entries(options.env)) {
      if (SHELL_PRECEDENCE_KEYS.has(key)) {
        // Network vars: shell wins, options.env is fallback
        if (!base[key]) {
          base[key] = value;
        }
      } else {
        // All other options.env values are set (host paths already handled above)
        base[key] = value;
      }
    }
  }

  return base;
}

export async function compose(
  configDir: string,
  config: WpDevConfig,
  composeArgs: string[],
  options: ComposeOptions = {},
): Promise<void> {
  const projectDir = getComposeProjectDir(configDir, config);
  const env = buildComposeEnv(projectDir, options);
  
  await execa(
    "docker",
    [...getDockerComposeLeadArgs(config), ...composeArgs],
    {
      cwd: projectDir,
      stdio: options.stdio ?? "inherit",
      reject: false,
      env,
    },
  ).then((r) => {
    if (r.exitCode !== 0) {
      const detail = [r.stderr?.trim(), r.stdout?.trim()].filter(Boolean).join("\n");
      throw new Error(
        detail.length > 0
          ? `docker compose failed with exit code ${r.exitCode}: ${detail}`
          : `docker compose failed with exit code ${r.exitCode}`,
      );
    }
  });
}

export interface ComposeReadResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run a read-only compose command (ps, config, etc.) with network env.
 * Use this for status checks that need compose to parse the file.
 * 
 * @param loaded - LoadedConfig with configDir and config
 * @param args - Compose arguments after 'docker compose -p <id> -f <file>'
 * @param networkEnv - Network env vars from resolveNetworkEnvForCompose()
 */
export async function composeRead(
  loaded: LoadedConfig,
  args: string[],
  networkEnv: Record<string, string>,
): Promise<ComposeReadResult> {
  const projectDir = getComposeProjectDir(loaded.configDir, loaded.config);
  const env = buildComposeEnv(projectDir, { env: networkEnv });

  const r = await execa(
    "docker",
    [...getDockerComposeLeadArgs(loaded.config), ...args],
    {
      cwd: projectDir,
      reject: false,
      stdio: ["ignore", "pipe", "pipe"],
      env,
    },
  );

  return {
    stdout: String(r.stdout ?? ""),
    stderr: String(r.stderr ?? ""),
    exitCode: r.exitCode ?? 1,
  };
}

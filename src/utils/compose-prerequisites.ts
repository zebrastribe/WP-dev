/**
 * Compose prerequisites: everything that must be ready before ANY compose call.
 *
 * Docker Compose creates missing bind-mount sources as directories and creates
 * networks with fallback subnets from the compose file. This module ensures:
 * 1. docker/.env exists with all required variables (network, security, paths)
 * 2. Generated bind-mount files exist as regular files (e.g., remoteip.conf)
 *
 * Call ensureComposePrerequisites() before ANY compose invocation:
 * - up (before autoReconcileOnStartup)
 * - doctor (before compose run)
 * - fix-permissions (before compose run)
 * - reconcile (before compose exec/run)
 *
 * This is the SINGLE point of truth for compose prerequisites.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type { LoadedConfig } from "../config/load.js";
import { dockerComposeProjectId } from "../services/docker-compose.js";
import {
  persistEnvContent,
  readEnvValue,
  runnerOriginPortMismatch,
  setEnvValueInContent,
  writeEnvFile,
} from "./compose-env.js";
import {
  deriveBindLocal,
  deriveNetworkIps,
  findAvailableSubnet,
  generateRemoteIpConf,
  getDockerNetworkGateway,
  getDockerNetworkSubnet,
  getSubnetPoolPrefix,
  dockerNetworkExists,
  normalizeWpBind,
  savedSubnetOverlapsExisting,
} from "./network-config.js";
import {
  resolveHostHome,
  resolveHostIdentity,
  resolveHostProjectRoot,
} from "./host-paths.js";
import { logInfo } from "./logger.js";
import {
  ensureGeneratedBindMountFiles,
  getRemoteIpConfPath,
} from "./generated-bind-mounts.js";

function makeToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

function getComposeEnvPath(loaded: LoadedConfig): string {
  return join(loaded.configDir, loaded.config.local.path, ".env");
}

function getComposeEnvExamplePath(loaded: LoadedConfig): string {
  return join(loaded.configDir, loaded.config.local.path, ".env.example");
}

function ensureComposeEnvExists(loaded: LoadedConfig): string {
  const envPath = getComposeEnvPath(loaded);
  const dockerDir = join(loaded.configDir, loaded.config.local.path);
  mkdirSync(dockerDir, { recursive: true });

  if (existsSync(envPath)) return envPath;

  const example = getComposeEnvExamplePath(loaded);
  if (existsSync(example)) {
    copyFileSync(example, envPath);
    return envPath;
  }

  writeEnvFile(envPath, "WP_PORT=8888\n", {
    configDir: loaded.configDir,
    projectId: loaded.config.project,
  });
  return envPath;
}

interface NetworkConfigResult {
  next: string;
  changed: boolean;
  changedKeys: string[];
  networkInfo: { subnet: string; gateway: string; sslProxyIp: string } | null;
}

function ensureNetworkConfig(
  loaded: LoadedConfig,
  envPath: string,
  current: string,
): NetworkConfigResult {
  let next = current;
  let changed = false;
  const changedKeys: string[] = [];

  const projectId = dockerComposeProjectId(loaded.config);
  const networkName = `${projectId}_wpdev`;

  const savedSubnet = readEnvValue(current, "WPDEV_NETWORK_SUBNET");
  const savedGateway = readEnvValue(current, "WPDEV_NETWORK_GATEWAY");

  let subnet: string;
  let gateway: string;
  let sslProxyIp: string;

  if (dockerNetworkExists(networkName)) {
    const actualSubnet = getDockerNetworkSubnet(networkName);
    const actualGateway = getDockerNetworkGateway(networkName);
    if (actualSubnet && actualGateway) {
      subnet = actualSubnet;
      gateway = actualGateway;
      const derived = deriveNetworkIps(subnet);
      sslProxyIp = derived?.sslProxyIp || "";
      logInfo(`compose-prereq: using existing network ${networkName} (${subnet}, gateway ${gateway})`);
    } else {
      throw new Error(
        `Network ${networkName} exists but could not read its configuration. ` +
          `Remove it with: docker network rm ${networkName}`,
      );
    }
  } else if (savedSubnet && savedGateway) {
    if (savedSubnetOverlapsExisting(savedSubnet, networkName)) {
      logInfo(`compose-prereq: saved subnet ${savedSubnet} collides with another network, reallocating`);
      const available = findAvailableSubnet();
      if (!available) {
        const poolPrefix = getSubnetPoolPrefix();
        throw new Error(
          `Could not find available subnet in ${poolPrefix}.0.0/16 range. ` +
            `Override with WPDEV_SUBNET_POOL or set WPDEV_NETWORK_SUBNET and WPDEV_NETWORK_GATEWAY manually in docker/.env.`,
        );
      }
      const derived = deriveNetworkIps(available);
      if (!derived) {
        throw new Error(`Invalid subnet ${available}`);
      }
      subnet = derived.subnet;
      gateway = derived.gateway;
      sslProxyIp = derived.sslProxyIp;
      logInfo(`compose-prereq: reallocated subnet ${subnet} (gateway ${gateway})`);
    } else {
      subnet = savedSubnet;
      gateway = savedGateway;
      const derived = deriveNetworkIps(subnet);
      sslProxyIp = readEnvValue(current, "WPDEV_SSL_PROXY_IP") || derived?.sslProxyIp || "";
      logInfo(`compose-prereq: reusing saved subnet ${subnet} (gateway ${gateway})`);
    }
  } else {
    const available = findAvailableSubnet();
    if (!available) {
      const poolPrefix = getSubnetPoolPrefix();
      throw new Error(
        `Could not find available subnet in ${poolPrefix}.0.0/16 range. ` +
          `Override with WPDEV_SUBNET_POOL or set WPDEV_NETWORK_SUBNET and WPDEV_NETWORK_GATEWAY manually in docker/.env.`,
      );
    }
    const derived = deriveNetworkIps(available);
    if (!derived) {
      throw new Error(`Invalid subnet ${available}`);
    }
    subnet = derived.subnet;
    gateway = derived.gateway;
    sslProxyIp = derived.sslProxyIp;
    logInfo(`compose-prereq: allocated new subnet ${subnet} (gateway ${gateway})`);
  }

  if (readEnvValue(next, "WPDEV_NETWORK_SUBNET") !== subnet) {
    next = setEnvValueInContent(next, "WPDEV_NETWORK_SUBNET", subnet);
    changed = true;
    changedKeys.push("WPDEV_NETWORK_SUBNET");
  }
  if (readEnvValue(next, "WPDEV_NETWORK_GATEWAY") !== gateway) {
    next = setEnvValueInContent(next, "WPDEV_NETWORK_GATEWAY", gateway);
    changed = true;
    changedKeys.push("WPDEV_NETWORK_GATEWAY");
  }
  if (readEnvValue(next, "WPDEV_SSL_PROXY_IP") !== sslProxyIp) {
    next = setEnvValueInContent(next, "WPDEV_SSL_PROXY_IP", sslProxyIp);
    changed = true;
    changedKeys.push("WPDEV_SSL_PROXY_IP");
  }
  if (readEnvValue(next, "WPDEV_ADMIN_TRUSTED_GATEWAY") !== gateway) {
    next = setEnvValueInContent(next, "WPDEV_ADMIN_TRUSTED_GATEWAY", gateway);
    changed = true;
    changedKeys.push("WPDEV_ADMIN_TRUSTED_GATEWAY");
  }

  return {
    next,
    changed,
    changedKeys,
    networkInfo: { subnet, gateway, sslProxyIp },
  };
}

function ensureBindLocalConfig(
  current: string,
): { next: string; changed: boolean; changedKeys: string[] } {
  let next = current;
  let changed = false;
  const changedKeys: string[] = [];

  const rawBind = readEnvValue(current, "WP_BIND");
  const existingBindLocal = readEnvValue(current, "WPDEV_WP_BIND_LOCAL");

  const wpBind = normalizeWpBind(rawBind);
  if (readEnvValue(next, "WP_BIND") !== wpBind) {
    next = setEnvValueInContent(next, "WP_BIND", wpBind);
    changed = true;
    changedKeys.push("WP_BIND");
    if (rawBind === "localhost") {
      logInfo("compose-prereq: normalized WP_BIND=localhost to 127.0.0.1 (compose requires IP)");
    }
  }

  const isLocal = deriveBindLocal(wpBind);
  const derivedBindLocal = isLocal ? "1" : "0";

  let finalBindLocal = derivedBindLocal;
  if (existingBindLocal === "0") {
    finalBindLocal = "0";
  } else if (existingBindLocal === "1" && !isLocal) {
    finalBindLocal = "0";
    logInfo("compose-prereq: WP_BIND is not localhost, forcing WPDEV_WP_BIND_LOCAL=0");
  }

  if (readEnvValue(next, "WPDEV_WP_BIND_LOCAL") !== finalBindLocal) {
    next = setEnvValueInContent(next, "WPDEV_WP_BIND_LOCAL", finalBindLocal);
    changed = true;
    changedKeys.push("WPDEV_WP_BIND_LOCAL");
  }

  return { next, changed, changedKeys };
}

function ensureRemoteIpConf(loaded: LoadedConfig, sslProxyIp: string | null, sslEnabled: boolean): void {
  const confPath = getRemoteIpConfPath(loaded);
  const trustedProxyIp = sslEnabled ? sslProxyIp : null;
  const content = generateRemoteIpConf(trustedProxyIp);

  const existing = existsSync(confPath) ? readFileSync(confPath, "utf8") : "";
  if (existing !== content) {
    writeFileSync(confPath, content, "utf8");
    logInfo(`compose-prereq: updated docker/remoteip.conf (ssl=${sslEnabled ? "on" : "off"})`);
  }
}

export interface ComposePrerequisitesResult {
  envPath: string;
  changed: boolean;
  changedKeys: string[];
  networkInfo: { subnet: string; gateway: string; sslProxyIp: string } | null;
}

/**
 * Ensure all compose prerequisites are ready.
 * MUST be called before ANY compose invocation (run/exec/up).
 *
 * This function:
 * 1. Creates docker/.env if missing (from .env.example or with defaults)
 * 2. Allocates network subnet/gateway (or reads from existing network)
 * 3. Sets all required security env values (tokens, paths, etc.)
 * 4. Creates generated bind-mount files (remoteip.conf)
 *
 * After this function returns, it is safe to call compose.
 */
export function ensureComposePrerequisites(loaded: LoadedConfig): ComposePrerequisitesResult {
  const envPath = ensureComposeEnvExists(loaded);
  let current = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const currentWpPort = readEnvValue(current, "WP_PORT") || "8888";

  let changed = false;
  const changedKeys: string[] = [];
  let next = current;

  // 1. Ensure generated bind-mount files exist FIRST (before any .env processing
  //    that might trigger compose via assertDockerReady or similar)
  ensureGeneratedBindMountFiles(loaded);

  // 2. Security tokens
  const adminToken = readEnvValue(current, "WPDEV_ADMIN_SAVE_TOKEN");
  const runnerToken = readEnvValue(current, "WPDEV_TERMINAL_RUNNER_TOKEN");
  const terminalAuth = readEnvValue(current, "WPDEV_TERMINAL_AUTH");
  const runnerOrigin = readEnvValue(current, "WPDEV_TERMINAL_RUNNER_ORIGIN");

  if (!adminToken || adminToken.includes("change-me")) {
    next = setEnvValueInContent(next, "WPDEV_ADMIN_SAVE_TOKEN", makeToken());
    changed = true;
    changedKeys.push("WPDEV_ADMIN_SAVE_TOKEN");
  }
  if (!runnerToken || runnerToken.includes("change-me")) {
    next = setEnvValueInContent(next, "WPDEV_TERMINAL_RUNNER_TOKEN", makeToken());
    changed = true;
    changedKeys.push("WPDEV_TERMINAL_RUNNER_TOKEN");
  }
  if (!terminalAuth || terminalAuth.includes("change-me") || terminalAuth === "wpdev:wpdev") {
    next = setEnvValueInContent(next, "WPDEV_TERMINAL_AUTH", `wpdev:${makeToken(12)}`);
    changed = true;
    changedKeys.push("WPDEV_TERMINAL_AUTH");
  }

  const shouldResetOrigin =
    !runnerOrigin ||
    runnerOrigin.includes("change-me") ||
    runnerOriginPortMismatch(runnerOrigin, Number.parseInt(currentWpPort, 10));
  if (shouldResetOrigin) {
    next = setEnvValueInContent(next, "WPDEV_TERMINAL_RUNNER_ORIGIN", `http://localhost:${currentWpPort}`);
    changed = true;
    changedKeys.push("WPDEV_TERMINAL_RUNNER_ORIGIN");
  }

  const hostRunnerPort = readEnvValue(next, "WPDEV_HOST_RUNNER_PORT");
  if (!hostRunnerPort || !/^\d+$/.test(hostRunnerPort)) {
    next = setEnvValueInContent(next, "WPDEV_HOST_RUNNER_PORT", "7683");
    changed = true;
    changedKeys.push("WPDEV_HOST_RUNNER_PORT");
  }

  // 3. Host paths (for compose from terminal container)
  const hostRoot = resolveHostProjectRoot(loaded.configDir, envPath);
  const hostHome = resolveHostHome(envPath);
  if (readEnvValue(next, "WPDEV_HOST_PROJECT_ROOT") !== hostRoot) {
    next = setEnvValueInContent(next, "WPDEV_HOST_PROJECT_ROOT", hostRoot);
    changed = true;
    changedKeys.push("WPDEV_HOST_PROJECT_ROOT");
  }
  if (readEnvValue(next, "WPDEV_HOST_HOME") !== hostHome) {
    next = setEnvValueInContent(next, "WPDEV_HOST_HOME", hostHome);
    changed = true;
    changedKeys.push("WPDEV_HOST_HOME");
  }
  const hostId = resolveHostIdentity(loaded.configDir);
  if (readEnvValue(next, "WPDEV_HOST_UID") !== String(hostId.uid)) {
    next = setEnvValueInContent(next, "WPDEV_HOST_UID", String(hostId.uid));
    changed = true;
    changedKeys.push("WPDEV_HOST_UID");
  }
  if (readEnvValue(next, "WPDEV_HOST_GID") !== String(hostId.gid)) {
    next = setEnvValueInContent(next, "WPDEV_HOST_GID", String(hostId.gid));
    changed = true;
    changedKeys.push("WPDEV_HOST_GID");
  }

  // 4. Network configuration (subnet, gateway, proxy IP)
  const networkResult = ensureNetworkConfig(loaded, envPath, next);
  next = networkResult.next;
  if (networkResult.changed) {
    changed = true;
    changedKeys.push(...networkResult.changedKeys);
  }

  // 5. Bind-local configuration (derived from WP_BIND)
  const bindResult = ensureBindLocalConfig(next);
  next = bindResult.next;
  if (bindResult.changed) {
    changed = true;
    changedKeys.push(...bindResult.changedKeys);
  }

  // 6. Persist .env changes
  if (changed) {
    persistEnvContent(envPath, next, loaded);
  }

  // 7. Generate remoteip.conf with correct content (now that we know SSL status)
  const sslEnabled = /^(1|true|yes)$/i.test(readEnvValue(next, "WPDEV_LOCAL_HTTPS") || "");
  ensureRemoteIpConf(loaded, networkResult.networkInfo?.sslProxyIp || null, sslEnabled);

  return {
    envPath,
    changed,
    changedKeys,
    networkInfo: networkResult.networkInfo,
  };
}

/**
 * Check if compose prerequisites are ready (for defensive checks).
 * Returns true if .env has required network vars and remoteip.conf exists as a file.
 */
export function areComposePrerequisitesReady(loaded: LoadedConfig): boolean {
  const envPath = getComposeEnvPath(loaded);
  if (!existsSync(envPath)) return false;

  const content = readFileSync(envPath, "utf8");
  if (!readEnvValue(content, "WPDEV_NETWORK_SUBNET")) return false;
  if (!readEnvValue(content, "WPDEV_NETWORK_GATEWAY")) return false;
  if (!readEnvValue(content, "WPDEV_HOST_PROJECT_ROOT")) return false;

  const confPath = getRemoteIpConfPath(loaded);
  if (!existsSync(confPath)) return false;

  const { statSync } = require("node:fs");
  const stat = statSync(confPath);
  if (!stat.isFile()) return false;

  return true;
}

export { getComposeEnvPath };

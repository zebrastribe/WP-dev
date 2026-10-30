import type { LoadedConfig } from "../config/load.js";
import { resolveFromConfigDir } from "../config/load.js";
import { compose, dockerComposeProjectId } from "../services/docker-compose.js";
import { assertDockerReady } from "../utils/docker-prereq.js";
import { logInfo } from "../utils/logger.js";
import {
  listSecurityEnvPlaceholderKeys,
  persistEnvContent,
  readEnvValue,
  runnerOriginPortMismatch,
  setEnvValueInContent,
  writeEnvFile,
} from "../utils/compose-env.js";
import {
  resolveHostHome,
  resolveHostIdentity,
  resolveHostProjectRoot,
} from "../utils/host-paths.js";
import {
  cleanupLegacyDefaultNetwork,
  deriveBindLocal,
  deriveNetworkIps,
  findAvailableSubnet,
  generateRemoteIpConf,
  getDockerNetworkGateway,
  getDockerNetworkIpRange,
  getDockerNetworkSubnet,
  getSubnetPoolPrefix,
  dockerNetworkExists,
  normalizeWpBind,
  savedSubnetOverlapsExisting,
} from "../utils/network-config.js";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import {
  autoReconcileOnStartup,
  probeWritable,
  reconcileContainerRuntime,
  reconcileSharedConfig,
} from "../fs/index.js";
import { recoverStaleState } from "../supervisor/recovery.js";
import {
  ensureSupervisorRunning,
  formatDuplicateInstanceMessage,
  isSupervisorAlreadyRunning,
  resolveSupervisorPort,
} from "../supervisor/client.js";
import {
  createInitialRegistry,
  printStartupSummary,
  runStartupStateMachine,
} from "../supervisor/startup.js";
import { saveRegistry } from "../supervisor/service-registry.js";

export type UpOptions = {
  relocatePorts?: boolean;
  reclaimPorts?: boolean;
  strictPorts?: boolean;
};

function getComposeEnvPath(loaded: LoadedConfig): string {
  return join(loaded.configDir, loaded.config.local.path, ".env");
}

function getComposeEnvExamplePath(loaded: LoadedConfig): string {
  return join(loaded.configDir, loaded.config.local.path, ".env.example");
}

function ensureComposeEnvExists(loaded: LoadedConfig): string {
  const envPath = getComposeEnvPath(loaded);
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

function makeToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * Configure Docker network for this stack with a unique subnet.
 * Returns network info derived from the actual network state.
 */
function ensureNetworkConfig(
  loaded: LoadedConfig,
  envPath: string,
  current: string,
): { next: string; changed: boolean; changedKeys: string[]; networkInfo: ReturnType<typeof deriveNetworkIps> } {
  let next = current;
  let changed = false;
  const changedKeys: string[] = [];

  // Get the compose project ID for this stack's network name
  const projectId = dockerComposeProjectId(loaded.config);
  const networkName = `${projectId}_wpdev`;

  // Check if user explicitly set subnet/gateway in .env
  const savedSubnet = readEnvValue(current, "WPDEV_NETWORK_SUBNET");
  const savedGateway = readEnvValue(current, "WPDEV_NETWORK_GATEWAY");

  let subnet: string;
  let gateway: string;
  let sslProxyIp: string;
  let ipRange: string;

  if (dockerNetworkExists(networkName)) {
    // Network exists - read actual values from Docker (authoritative)
    // G14: For existing networks, read the ACTUAL ip_range, don't derive a new one.
    // This prevents network recreation on upgrade.
    const actualSubnet = getDockerNetworkSubnet(networkName);
    const actualGateway = getDockerNetworkGateway(networkName);
    const actualIpRange = getDockerNetworkIpRange(networkName);
    if (actualSubnet && actualGateway) {
      subnet = actualSubnet;
      gateway = actualGateway;
      const derived = deriveNetworkIps(subnet);
      sslProxyIp = derived?.sslProxyIp || "";
      // Use the ACTUAL ip_range from the network, not a derived one.
      // Networks created before ip_range support have none - keep it empty.
      ipRange = actualIpRange;
      if (!actualIpRange) {
        logInfo(`up: using existing network ${networkName} (${subnet}, no ip_range - reservation applies on fresh networks)`);
      } else {
        logInfo(`up: using existing network ${networkName} (${subnet}, ip_range ${actualIpRange})`);
      }
    } else {
      throw new Error(
        `Network ${networkName} exists but could not read its configuration. ` +
          `Remove it with: docker network rm ${networkName}`,
      );
    }
  } else if (savedSubnet && savedGateway) {
    // Network doesn't exist but we have saved values from a previous run.
    // Check if the saved subnet collides with another stack that took it while we were down.
    if (savedSubnetOverlapsExisting(savedSubnet, networkName)) {
      // Collision detected - another stack took our subnet. Reallocate.
      logInfo(`up: saved subnet ${savedSubnet} collides with another network, reallocating`);
      const available = findAvailableSubnet(undefined, envPath);
      if (!available) {
        const poolPrefix = getSubnetPoolPrefix(envPath);
        throw new Error(
          `Could not find available subnet in ${poolPrefix}.0.0/16 range. ` +
            `All subnets may be in use by Docker networks or host routes (VPNs, private networks). ` +
            `Override with WPDEV_SUBNET_POOL in docker/.env or shell environment, ` +
            `or set WPDEV_NETWORK_SUBNET and WPDEV_NETWORK_GATEWAY manually.`,
        );
      }
      const derived = deriveNetworkIps(available);
      if (!derived) {
        throw new Error(`Invalid subnet ${available}`);
      }
      subnet = derived.subnet;
      gateway = derived.gateway;
      sslProxyIp = derived.sslProxyIp;
      ipRange = derived.ipRange;
      logInfo(`up: reallocated subnet ${subnet} (gateway ${gateway})`);
    } else {
      // Saved subnet is still available - reuse it
      subnet = savedSubnet;
      gateway = savedGateway;
      const derived = deriveNetworkIps(subnet);
      sslProxyIp = readEnvValue(current, "WPDEV_SSL_PROXY_IP") || derived?.sslProxyIp || "";
      ipRange = readEnvValue(current, "WPDEV_NETWORK_IP_RANGE") || derived?.ipRange || "";
      logInfo(`up: reusing saved subnet ${subnet} (gateway ${gateway})`);
    }
  } else {
    // No network, no saved config - allocate fresh
    const available = findAvailableSubnet(undefined, envPath);
    if (!available) {
      const poolPrefix = getSubnetPoolPrefix(envPath);
      throw new Error(
        `Could not find available subnet in ${poolPrefix}.0.0/16 range. ` +
          `All subnets may be in use by Docker networks or host routes (VPNs, private networks). ` +
          `Override with WPDEV_SUBNET_POOL in docker/.env or shell environment, ` +
          `or set WPDEV_NETWORK_SUBNET and WPDEV_NETWORK_GATEWAY manually.`,
      );
    }
    const derived = deriveNetworkIps(available);
    if (!derived) {
      throw new Error(`Invalid subnet ${available}`);
    }
    subnet = derived.subnet;
    gateway = derived.gateway;
    sslProxyIp = derived.sslProxyIp;
    ipRange = derived.ipRange;
    logInfo(`up: allocated new subnet ${subnet} (gateway ${gateway})`);
  }

  // Update env if values changed
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

  // ip_range reserves fixed IPs (gateway, SSL proxy) from dynamic allocation
  if (readEnvValue(next, "WPDEV_NETWORK_IP_RANGE") !== ipRange) {
    next = setEnvValueInContent(next, "WPDEV_NETWORK_IP_RANGE", ipRange);
    changed = true;
    changedKeys.push("WPDEV_NETWORK_IP_RANGE");
  }

  // Trusted gateway for admin API - always sync with network gateway
  if (readEnvValue(next, "WPDEV_ADMIN_TRUSTED_GATEWAY") !== gateway) {
    next = setEnvValueInContent(next, "WPDEV_ADMIN_TRUSTED_GATEWAY", gateway);
    changed = true;
    changedKeys.push("WPDEV_ADMIN_TRUSTED_GATEWAY");
  }

  return {
    next,
    changed,
    changedKeys,
    networkInfo: { subnet, gateway, sslProxyIp, ipRange },
  };
}

/**
 * Ensure WP_BIND and WPDEV_WP_BIND_LOCAL are correctly set.
 * - WP_BIND defaults to 127.0.0.1 (secure)
 * - WP_BIND=localhost is normalized to 127.0.0.1 (compose rejects "localhost")
 * - WPDEV_WP_BIND_LOCAL is ALWAYS derived from actual WP_BIND value on every `up`
 *   (no sticky values - changing WP_BIND back to localhost unlocks the API again)
 */
function ensureBindLocalConfig(
  current: string,
): { next: string; changed: boolean; changedKeys: string[] } {
  let next = current;
  let changed = false;
  const changedKeys: string[] = [];

  const rawBind = readEnvValue(current, "WP_BIND");

  // Normalize WP_BIND: default to 127.0.0.1, convert "localhost" to IP, validate
  const wpBind = normalizeWpBind(rawBind);
  if (readEnvValue(next, "WP_BIND") !== wpBind) {
    next = setEnvValueInContent(next, "WP_BIND", wpBind);
    changed = true;
    changedKeys.push("WP_BIND");
    if (rawBind === "localhost") {
      logInfo("up: normalized WP_BIND=localhost to 127.0.0.1 (compose requires IP)");
    }
  }

  // ALWAYS derive bind-local from actual WP_BIND (recompute on every up)
  // This ensures changing WP_BIND updates the gate: localhost=1, else=0
  const isLocal = deriveBindLocal(wpBind);
  const bindLocal = isLocal ? "1" : "0";

  if (readEnvValue(next, "WPDEV_WP_BIND_LOCAL") !== bindLocal) {
    next = setEnvValueInContent(next, "WPDEV_WP_BIND_LOCAL", bindLocal);
    changed = true;
    changedKeys.push("WPDEV_WP_BIND_LOCAL");
    if (!isLocal) {
      logInfo("up: WP_BIND is not localhost, setting WPDEV_WP_BIND_LOCAL=0 (admin API gated)");
    }
  }

  return { next, changed, changedKeys };
}

/**
 * Generate remoteip.conf to restrict X-Forwarded-For trust.
 * Must be called BEFORE compose runs - if missing, Docker creates a directory.
 *
 * @param sslEnabled Whether SSL profile is enabled (only trust proxy when SSL is on)
 */
function ensureRemoteIpConf(loaded: LoadedConfig, sslProxyIp: string | null, sslEnabled: boolean): void {
  const confPath = join(loaded.configDir, "docker/remoteip.conf");

  // Detect if Docker created a directory (happens if compose ran without the file)
  if (existsSync(confPath)) {
    const stat = statSync(confPath);
    if (stat.isDirectory()) {
      throw new Error(
        `docker/remoteip.conf is a directory (Docker created it because the file was missing). ` +
          `Remove it and run wp-dev up again: rm -rf "${confPath}"`,
      );
    }
  }

  // Only trust the SSL proxy IP when SSL profile is enabled
  // When SSL is off, trust no proxy (any container could get .10 IP)
  const trustedProxyIp = sslEnabled ? sslProxyIp : null;
  const content = generateRemoteIpConf(trustedProxyIp);

  const existing = existsSync(confPath) ? readFileSync(confPath, "utf8") : "";
  if (existing !== content) {
    writeFileSync(confPath, content, "utf8");
    logInfo(`up: generated docker/remoteip.conf (ssl=${sslEnabled ? "on" : "off"})`);
  }
}

function ensureSecurityEnvDefaults(loaded: LoadedConfig, envPath: string): void {
  const current = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const currentWpPort = readEnvValue(current, "WP_PORT") || "8888";

  const adminToken = readEnvValue(current, "WPDEV_ADMIN_SAVE_TOKEN");
  const runnerToken = readEnvValue(current, "WPDEV_TERMINAL_RUNNER_TOKEN");
  const terminalAuth = readEnvValue(current, "WPDEV_TERMINAL_AUTH");
  const runnerOrigin = readEnvValue(current, "WPDEV_TERMINAL_RUNNER_ORIGIN");

  const needsAdminToken = !adminToken || adminToken.includes("change-me");
  const needsRunnerToken = !runnerToken || runnerToken.includes("change-me");

  let next = current;
  let changed = false;
  const changedKeys: string[] = [];

  if (needsAdminToken) {
    next = setEnvValueInContent(next, "WPDEV_ADMIN_SAVE_TOKEN", makeToken());
    changed = true;
    changedKeys.push("WPDEV_ADMIN_SAVE_TOKEN");
  }
  if (needsRunnerToken) {
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
    next = setEnvValueInContent(
      next,
      "WPDEV_TERMINAL_RUNNER_ORIGIN",
      `http://localhost:${currentWpPort}`,
    );
    changed = true;
    changedKeys.push("WPDEV_TERMINAL_RUNNER_ORIGIN");
  }
  const hostRunnerPort = readEnvValue(next, "WPDEV_HOST_RUNNER_PORT");
  if (!hostRunnerPort || !/^\d+$/.test(hostRunnerPort)) {
    next = setEnvValueInContent(next, "WPDEV_HOST_RUNNER_PORT", "7683");
    changed = true;
    changedKeys.push("WPDEV_HOST_RUNNER_PORT");
  }

  // Persist absolute host paths so compose from the terminal container (docker.sock)
  // does not resolve relative binds to /workspace/... on the host.
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

  // Network configuration (subnet, gateway, proxy IP)
  const networkResult = ensureNetworkConfig(loaded, envPath, next);
  next = networkResult.next;
  if (networkResult.changed) {
    changed = true;
    changedKeys.push(...networkResult.changedKeys);
  }

  // Bind-local configuration (derived from WP_BIND)
  const bindResult = ensureBindLocalConfig(next);
  next = bindResult.next;
  if (bindResult.changed) {
    changed = true;
    changedKeys.push(...bindResult.changedKeys);
  }

  // Generate remoteip.conf - only trust proxy IP when SSL profile is enabled
  const sslEnabled = /^(1|true|yes)$/i.test(readEnvValue(next, "WPDEV_LOCAL_HTTPS") || "");
  ensureRemoteIpConf(loaded, networkResult.networkInfo?.sslProxyIp || null, sslEnabled);

  if (changed) {
    persistEnvContent(envPath, next, loaded);
    console.error(
      `Auto-updated docker/.env security values: ${changedKeys.join(", ")}\n` +
        "Run this stack restart to apply if already running: npm run wp-dev -- down && npm run wp-dev -- up\n",
    );
  }
}

function warnIfSecurityEnvPlaceholders(envPath: string): void {
  const current = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const missingOrPlaceholder = listSecurityEnvPlaceholderKeys(current);
  if (missingOrPlaceholder.length === 0) return;
  console.error(
    "Security setup required in docker/.env before using admin terminal/save features:\n" +
      missingOrPlaceholder.map((k) => `  - ${k}`).join("\n") +
      "\nSet strong values, then run: npm run wp-dev -- down && npm run wp-dev -- up\n",
  );
}

function ensureWordPressSetupAssetsOnHost(loaded: LoadedConfig): boolean {
  const wpRoot = resolveFromConfigDir(loaded.configDir, loaded.config.local.wpRoot);
  const src = join(loaded.configDir, "docker/assets/mu-plugins/wp-dev-setup.php");
  if (!existsSync(src)) return true;

  const destDir = join(wpRoot, "wp-content/mu-plugins");
  const destFile = join(destDir, "wp-dev-setup.php");
  try {
    mkdirSync(destDir, { recursive: true });
    copyFileSync(src, destFile);
    logInfo("up: ensured wp-dev setup mu-plugin in wordpress/wp-content/mu-plugins/");
    return true;
  } catch (e) {
    const code = e && typeof e === "object" && "code" in e ? String(e.code) : "";
    if (code === "EACCES" || code === "EPERM") {
      logInfo(
        "up: wp-content not writable on host (www-data); will install setup mu-plugin via Docker after stack starts",
      );
      return false;
    }
    throw e;
  }
}

async function ensureWordPressSetupAssetsViaDocker(loaded: LoadedConfig): Promise<void> {
  const src = join(loaded.configDir, "docker/assets/mu-plugins/wp-dev-setup.php");
  if (!existsSync(src)) return;
  try {
    await compose(
      loaded.configDir,
      loaded.config,
      [
        "run",
        "--rm",
        "--no-deps",
        "--user",
        "0",
        "--entrypoint",
        "sh",
        "wordpress",
        "-lc",
        [
          "mkdir -p /var/www/html/wp-content/mu-plugins",
          "cp /wp-dev-repo/docker/assets/mu-plugins/wp-dev-setup.php /var/www/html/wp-content/mu-plugins/wp-dev-setup.php",
          "chown 33:33 /var/www/html/wp-content/mu-plugins/wp-dev-setup.php",
          "chmod 664 /var/www/html/wp-content/mu-plugins/wp-dev-setup.php",
        ].join(" && "),
      ],
      { stdio: "pipe" },
    );
    logInfo("up: ensured wp-dev setup mu-plugin via Docker");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logInfo(`up: could not install setup mu-plugin via Docker (${msg})`);
  }
}

async function applyRuntimeWritePermissionsWithRetry(
  loaded: LoadedConfig,
  attempts = 3,
): Promise<void> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      // Same contract as post-pull: host:www-data tree + www-data runtime (FS_METHOD=direct).
      await reconcileContainerRuntime(loaded);
      return;
    } catch (e) {
      lastError = e;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  }
  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  logInfo(`up: could not apply WordPress write permissions (${msg})`);
  console.error(
    "Warning: could not apply WordPress write permissions. Core/theme/plugin updates may fail or ask for FTP.",
  );
  console.error("Try: npm run wp-dev -- fix-runtime-permissions");
}

async function ensureDockerEnvWritableBeforeUp(
  loaded: LoadedConfig,
  envPath: string,
): Promise<void> {
  if (probeWritable(envPath)) return;
  try {
    await reconcileSharedConfig(loaded);
    logInfo("up: restored writable docker/.env via filesystem manager");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `docker/.env is not writable (${msg}). Run: npm run wp-dev -- doctor --filesystem`,
    );
  }
  if (!probeWritable(envPath)) {
    throw new Error(
      "docker/.env is still not writable after filesystem recovery. Run: npm run wp-dev -- doctor --filesystem",
    );
  }
}

async function ensureAdminSaveWriteAccess(loaded: LoadedConfig): Promise<void> {
  try {
    await reconcileSharedConfig(loaded);
    logInfo("admin save: ensured shared config paths are writable");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logInfo(`admin save: could not enforce shared config permissions (${msg})`);
    console.error(
      "Warning: could not auto-fix admin save permissions. Run: npm run wp-dev -- doctor --filesystem",
    );
  }
}

export async function cmdUp(loaded: LoadedConfig, options: UpOptions = {}): Promise<void> {
  assertDockerReady();
  await recoverStaleState(loaded);
  await autoReconcileOnStartup(loaded);

  if (isSupervisorAlreadyRunning(loaded)) {
    console.error(formatDuplicateInstanceMessage(loaded));
    console.error("Stack may already be running. Showing status URLs:");
    printStartupSummary(loaded);
    return;
  }

  const muPluginOnHost = ensureWordPressSetupAssetsOnHost(loaded);
  const envPath = ensureComposeEnvExists(loaded);

  const registry = createInitialRegistry(loaded, process.pid, resolveSupervisorPort(loaded));
  saveRegistry(loaded.configDir, registry);

  const sslEnabled = /^(1|true|yes)$/i.test(
    readEnvValue(existsSync(envPath) ? readFileSync(envPath, "utf8") : "", "WPDEV_LOCAL_HTTPS"),
  );

  const { wpInstalled } = await runStartupStateMachine(
    loaded,
    envPath,
    registry,
    {
      strictPorts: options.strictPorts !== false && !options.relocatePorts,
      relocatePorts: options.relocatePorts,
      reclaimPorts: options.reclaimPorts,
      sslEnabled,
    },
    {
      ensureSecurityEnv: () => {
        ensureSecurityEnvDefaults(loaded, envPath);
        warnIfSecurityEnvPlaceholders(envPath);
      },
      ensureDockerEnvWritable: () => ensureDockerEnvWritableBeforeUp(loaded, envPath),
      ensureComposeEnv: () => {
        void ensureComposeEnvExists(loaded);
      },
      postStack: async () => {
        await ensureAdminSaveWriteAccess(loaded);
        await applyRuntimeWritePermissionsWithRetry(loaded);
        if (!muPluginOnHost) {
          await ensureWordPressSetupAssetsViaDocker(loaded);
        }
      },
    },
  );

  try {
    await ensureSupervisorRunning(loaded);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logInfo(`up: supervisor watch daemon skipped (${msg})`);
  }

  // Clean up legacy _default network after successful migration to _wpdev network.
  // Only removes if no containers are using it.
  const projectId = dockerComposeProjectId(loaded.config);
  const legacyCleanup = cleanupLegacyDefaultNetwork(projectId);
  if (legacyCleanup.removed) {
    logInfo(`up: removed legacy network ${projectId}_default (migrated to ${projectId}_wpdev)`);
  } else if (legacyCleanup.reason && !legacyCleanup.reason.includes("does not exist")) {
    logInfo(`up: legacy network ${projectId}_default not removed: ${legacyCleanup.reason}`);
  }

  printStartupSummary(loaded, wpInstalled);
}

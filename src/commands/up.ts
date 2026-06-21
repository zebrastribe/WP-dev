import type { LoadedConfig } from "../config/load.js";
import { resolveFromConfigDir } from "../config/load.js";
import { compose } from "../services/docker-compose.js";
import { assertDockerReady } from "../utils/docker-prereq.js";
import { logInfo } from "../utils/logger.js";
import { getPublishedLocalAccess } from "../utils/published-local-urls.js";
import { openBrowserCommand } from "../utils/platform-hints.js";
import { syncLocalWordPressUrls } from "../utils/sync-local-urls.js";
import {
  getComposePublishedHostPorts,
  isPortOwnedByComposeProject,
} from "../utils/compose-published-ports.js";
import {
  extractBoundPort,
  listSecurityEnvPlaceholderKeys,
  maybeUpdateLocalUrlPort,
  maybeUpdateRunnerOriginPort,
  parseDockerEnvPorts,
  readEnvValue,
  resolveConflictPortKey,
  runnerOriginPortMismatch,
  setEnvValueInContent,
  setPortInEnvFile,
  type DockerEnvPortKey,
} from "../utils/compose-env.js";
import {
  accessSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import net from "node:net";
import { cmdFixRuntimeWritePermissions } from "./fix-permissions.js";
import { startHostRunner, stopHostRunner } from "../services/host-runner.js";
import { isLocalWpInstalled, waitForLocalMysqlReady } from "../services/wpcli.js";

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
  writeFileSync(envPath, "WP_PORT=8888\n", "utf8");
  return envPath;
}

function makeToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

function ensureSecurityEnvDefaults(envPath: string): void {
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

  if (changed) {
    writeFileSync(envPath, next.endsWith("\n") ? next : `${next}\n`, "utf8");
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

async function isPortFree(port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on("error", () => resolve(false));
    server.listen({ host: "0.0.0.0", port }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findFreePort(startAt: number, projectPorts: Set<number>): Promise<number> {
  for (let p = startAt; p <= 65535; p++) {
    if (isPortOwnedByComposeProject(p, projectPorts) || (await isPortFree(p))) return p;
  }
  throw new Error(`Could not find a free local TCP port from ${startAt}..65535`);
}

async function ensureNonConflictingPublishedPorts(
  loaded: LoadedConfig,
  envPath: string,
): Promise<void> {
  const envContent = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const current = parseDockerEnvPorts(envContent);

  const projectPorts = await getComposePublishedHostPorts(loaded.configDir, loaded.config);

  const used = new Set<number>();
  let changed = false;

  const portAvailable = async (candidate: number): Promise<boolean> => {
    if (isPortOwnedByComposeProject(candidate, projectPorts)) return true;
    return isPortFree(candidate);
  };

  const allocate = async (key: DockerEnvPortKey, startAt: number): Promise<number> => {
    let candidate = startAt;
    while (candidate <= 65535) {
      if (!used.has(candidate) && (await portAvailable(candidate))) {
        used.add(candidate);
        return candidate;
      }
      candidate += 1;
    }
    throw new Error(`Could not find a free local TCP port for ${key} from ${startAt}..65535`);
  };

  const nextWpPort = await allocate("WP_PORT", current.WP_PORT);
  if (nextWpPort !== current.WP_PORT) {
    setPortInEnvFile(envPath, "WP_PORT", nextWpPort);
    maybeUpdateLocalUrlPort(loaded, nextWpPort);
    maybeUpdateRunnerOriginPort(envPath, nextWpPort);
    changed = true;
  }
  const nextHttpsPort = await allocate("WP_HTTPS_PORT", current.WP_HTTPS_PORT);
  if (nextHttpsPort !== current.WP_HTTPS_PORT) {
    setPortInEnvFile(envPath, "WP_HTTPS_PORT", nextHttpsPort);
    changed = true;
  }

  const nextTerminalPort = await allocate("WPDEV_TERMINAL_PORT", current.WPDEV_TERMINAL_PORT);
  if (nextTerminalPort !== current.WPDEV_TERMINAL_PORT) {
    setPortInEnvFile(envPath, "WPDEV_TERMINAL_PORT", nextTerminalPort);
    changed = true;
  }

  const nextRunnerPort = await allocate(
    "WPDEV_TERMINAL_RUNNER_PORT",
    current.WPDEV_TERMINAL_RUNNER_PORT,
  );
  if (nextRunnerPort !== current.WPDEV_TERMINAL_RUNNER_PORT) {
    setPortInEnvFile(envPath, "WPDEV_TERMINAL_RUNNER_PORT", nextRunnerPort);
    changed = true;
  }
  const nextHostRunnerPort = await allocate(
    "WPDEV_HOST_RUNNER_PORT",
    current.WPDEV_HOST_RUNNER_PORT,
  );
  if (nextHostRunnerPort !== current.WPDEV_HOST_RUNNER_PORT) {
    setPortInEnvFile(envPath, "WPDEV_HOST_RUNNER_PORT", nextHostRunnerPort);
    changed = true;
  }

  if (changed) {
    logInfo(
      `Auto-adjusted published ports in ${envPath}: ` +
        `WP_PORT=${nextWpPort}, ` +
        `WP_HTTPS_PORT=${nextHttpsPort}, ` +
        `WPDEV_TERMINAL_PORT=${nextTerminalPort}, ` +
        `WPDEV_TERMINAL_RUNNER_PORT=${nextRunnerPort}, ` +
        `WPDEV_HOST_RUNNER_PORT=${nextHostRunnerPort}`,
    );
    console.error(
      `Auto-adjusted published ports to avoid conflicts: ` +
        `WP_PORT=${nextWpPort}, https=${nextHttpsPort}, terminal=${nextTerminalPort}, runner=${nextRunnerPort}, host-runner=${nextHostRunnerPort}`,
    );
  }
}

function printPublishedAccessUrls(loaded: LoadedConfig, wpInstalled?: boolean): void {
  const { site, admin, warnings } = getPublishedLocalAccess(loaded);
  for (const w of warnings) console.error(w);
  if (wpInstalled === false) {
    console.error(`\n*** Start here (setup wizard): ${admin}`);
    console.error(`Local WordPress: ${site} (opens installer after you pull or finish sync)`);
  } else {
    console.error(`\nLocal WordPress: ${site}`);
    console.error(`Browser admin:   ${admin}`);
  }
  const openCmd = openBrowserCommand(wpInstalled === false ? admin : admin);
  if (openCmd) {
    console.error(`Open in browser: ${openCmd}`);
  }
  console.error(
    `\nTo stop this stack and free the published port: npm run wp-dev -- down`,
  );
  console.error(
    `(Each clone has its own Compose project; WP_PORT is in docker/.env.)\n`,
  );
}

/** Best-effort copy on host; returns false when wp-content is not writable (www-data). */
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

/** Install setup mu-plugin via container when host cannot write wp-content/. */
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
      await cmdFixRuntimeWritePermissions(loaded, { quiet: true });
      return;
    } catch (e) {
      lastError = e;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  }
  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  logInfo(`up: could not apply runtime wp-content write permissions (${msg})`);
  console.error(
    "Warning: could not apply runtime write permissions for wp-content. Plugin updates may fail.",
  );
  console.error("Try: npm run wp-dev -- fix-runtime-permissions");
}

const ADMIN_SAVE_MOUNT_SHELL = [
  "touch /wp-dev-repo/wp-dev.config.json",
  "chmod 666 /wp-dev-repo/wp-dev.config.json",
  "mkdir -p /wp-dev-repo/docker",
  "touch /wp-dev-repo/docker/.env",
  "chmod 777 /wp-dev-repo/docker",
  "chmod 666 /wp-dev-repo/docker/.env",
].join(" && ");

function isPathWritable(path: string): boolean {
  try {
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** Fix www-data-owned docker/.env before host CLI writes ports or security defaults. */
async function ensureDockerEnvWritableBeforeUp(
  loaded: LoadedConfig,
  envPath: string,
): Promise<void> {
  if (isPathWritable(envPath)) return;
  try {
    await compose(
      loaded.configDir,
      loaded.config,
      [
        "run",
        "--rm",
        "--no-deps",
        "-u",
        "0",
        "wordpress",
        "sh",
        "-lc",
        [
          "mkdir -p /wp-dev-repo/docker",
          "touch /wp-dev-repo/docker/.env",
          "chmod 777 /wp-dev-repo/docker",
          "chmod 666 /wp-dev-repo/docker/.env",
        ].join(" && "),
      ],
      { stdio: "pipe" },
    );
    logInfo("up: restored writable docker/.env (was www-data-owned)");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `docker/.env is not writable (${msg}). Fix with:\n` +
        `  docker compose -f docker/docker-compose.yml run --rm --no-deps -u 0 wordpress sh -lc "chmod 666 /wp-dev-repo/docker/.env"\n` +
        `  or: sudo chown $(id -un):$(id -gn) docker/.env`,
    );
  }
  if (!isPathWritable(envPath)) {
    throw new Error(
      "docker/.env is still not writable after permission fix. Run:\n" +
        "  chmod u+rw docker/.env\n" +
        "  or: sudo chown $(id -un):$(id -gn) docker/.env",
    );
  }
}

async function ensureAdminSaveWriteAccess(loaded: LoadedConfig): Promise<void> {
  try {
    await compose(
      loaded.configDir,
      loaded.config,
      ["exec", "-T", "-u", "0", "wordpress", "sh", "-lc", ADMIN_SAVE_MOUNT_SHELL],
      { stdio: "pipe" },
    );
    logInfo("admin save: ensured config and docker/.env mounts are writable");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logInfo(`admin save: could not enforce writable mounts (${msg})`);
    console.error(
      "Warning: could not auto-fix admin save permissions. If save fails, run:\n" +
        "  chmod u+rw wp-dev.config.json\n" +
        "  chmod o+w docker docker/.env\n",
    );
  }
}

export async function cmdUp(loaded: LoadedConfig): Promise<void> {
  assertDockerReady();
  const muPluginOnHost = ensureWordPressSetupAssetsOnHost(loaded);
  const envPath = ensureComposeEnvExists(loaded);
  await ensureDockerEnvWritableBeforeUp(loaded, envPath);
  const envContent = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const sslEnabled = /^(1|true|yes)$/i.test(readEnvValue(envContent, "WPDEV_LOCAL_HTTPS"));
  await ensureNonConflictingPublishedPorts(loaded, envPath);
  ensureSecurityEnvDefaults(envPath);
  warnIfSecurityEnvPlaceholders(envPath);
  try {
    logInfo(`docker compose ${sslEnabled ? "--profile ssl " : ""}up -d`);
    await compose(
      loaded.configDir,
      loaded.config,
      sslEnabled ? ["--profile", "ssl", "up", "-d"] : ["up", "-d"],
      { stdio: "pipe" },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const conflictPort = extractBoundPort(msg);
    if (!conflictPort) throw e;

    const envContent = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
    const ports = parseDockerEnvPorts(envContent);
    const key = resolveConflictPortKey(conflictPort, ports);
    const nextPort = await findFreePort(
      conflictPort + 1,
      await getComposePublishedHostPorts(loaded.configDir, loaded.config),
    );
    setPortInEnvFile(envPath, key, nextPort);
    if (key === "WP_PORT") {
      maybeUpdateLocalUrlPort(loaded, nextPort);
      maybeUpdateRunnerOriginPort(envPath, nextPort);
    }
    ensureSecurityEnvDefaults(envPath);

    logInfo(`Port ${conflictPort} is in use. Updated ${envPath} ${key}=${nextPort} and retrying.`);
    console.error(`Port ${conflictPort} is in use. Switched ${key} to ${nextPort} and retrying...`);

    await ensureNonConflictingPublishedPorts(loaded, envPath);
    await compose(
      loaded.configDir,
      loaded.config,
      sslEnabled ? ["--profile", "ssl", "up", "-d"] : ["up", "-d"],
      { stdio: "pipe" },
    );
  }

  await ensureAdminSaveWriteAccess(loaded);
  stopHostRunner(loaded.configDir);
  startHostRunner(loaded.configDir, envPath);
  try {
    await waitForLocalMysqlReady(loaded.configDir, loaded.config);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logInfo(`up: mysql readiness wait skipped (${msg})`);
  }
  await applyRuntimeWritePermissionsWithRetry(loaded);
  if (!muPluginOnHost) {
    await ensureWordPressSetupAssetsViaDocker(loaded);
  }
  let wpInstalled: boolean | undefined;
  try {
    wpInstalled = await isLocalWpInstalled(loaded.configDir, loaded.config);
  } catch {
    wpInstalled = undefined;
  }
  try {
    const sync = await syncLocalWordPressUrls(loaded);
    if (sync.synced) {
      const parts: string[] = [];
      if (sync.replacedFrom && sync.replacedFrom.length > 0) {
        parts.push(`options: ${sync.replacedFrom.join(", ")}`);
      }
      if ((sync.contentReplacements ?? 0) > 0) {
        parts.push(`${sync.contentReplacements} content URL replacement(s)`);
      }
      const detail = parts.length > 0 ? ` (${parts.join("; ")})` : "";
      console.error(
        `Synced WordPress URLs to ${sync.expectedUrl}${detail}. ` +
          `Previous: home=${sync.previousHome ?? "?"} siteurl=${sync.previousSiteurl ?? "?"}`,
      );
    } else if (!sync.skipped && !sync.urlsOk) {
      console.error(
        `Warning: WordPress URLs may still differ from ${sync.expectedUrl}. ` +
          `home=${sync.previousHome ?? "?"} siteurl=${sync.previousSiteurl ?? "?"}. ` +
          `Try: npm run wp-dev -- doctor --local-http`,
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logInfo(`up: could not sync WordPress URLs (${msg})`);
    console.error(
      `Warning: could not sync WordPress home/siteurl to the published local URL (${msg}).`,
    );
  }
  printPublishedAccessUrls(loaded, wpInstalled);
}

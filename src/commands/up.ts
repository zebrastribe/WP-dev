import type { LoadedConfig } from "../config/load.js";
import { resolveFromConfigDir, writeWpDevConfig } from "../config/load.js";
import { compose } from "../services/docker-compose.js";
import { assertDockerReady } from "../utils/docker-prereq.js";
import { logInfo } from "../utils/logger.js";
import { getPublishedLocalAccess } from "../utils/published-local-urls.js";
import { openBrowserCommand } from "../utils/platform-hints.js";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import net from "node:net";
import { cmdFixRuntimeWritePermissions } from "./fix-permissions.js";
import { startHostRunner, stopHostRunner } from "../services/host-runner.js";
import { isLocalWpInstalled, waitForLocalMysqlReady } from "../services/wpcli.js";

function extractBoundPort(message: string): number | null {
  const m = message.match(/:(\d+)\s+failed:\s+port is already allocated/i);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

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

function setWpPortInEnvFile(path: string, port: number): void {
  const line = `WP_PORT=${port}`;
  const current = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (/^WP_PORT=.*$/m.test(current)) {
    const next = current.replace(/^WP_PORT=.*$/m, line);
    writeFileSync(path, next.endsWith("\n") ? next : `${next}\n`, "utf8");
    return;
  }
  const prefix = current.trim().length > 0 ? `${current.replace(/\s*$/, "")}\n` : "";
  writeFileSync(path, `${prefix}${line}\n`, "utf8");
}

function setPortInEnvFile(
  path: string,
  key:
    | "WP_PORT"
    | "WP_HTTPS_PORT"
    | "WPDEV_TERMINAL_PORT"
    | "WPDEV_TERMINAL_RUNNER_PORT"
    | "WPDEV_HOST_RUNNER_PORT",
  port: number,
): void {
  const line = `${key}=${port}`;
  const current = existsSync(path) ? readFileSync(path, "utf8") : "";
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`^${escaped}=.*$`, "m").test(current)) {
    const next = current.replace(new RegExp(`^${escaped}=.*$`, "m"), line);
    writeFileSync(path, next.endsWith("\n") ? next : `${next}\n`, "utf8");
    return;
  }
  const prefix = current.trim().length > 0 ? `${current.replace(/\s*$/, "")}\n` : "";
  writeFileSync(path, `${prefix}${line}\n`, "utf8");
}

function setEnvValueInContent(content: string, key: string, value: string): string {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const line = `${key}=${value}`;
  if (new RegExp(`^${escaped}=.*$`, "m").test(content)) {
    return content.replace(new RegExp(`^${escaped}=.*$`, "m"), line);
  }
  const prefix = content.trim().length > 0 ? `${content.replace(/\s*$/, "")}\n` : "";
  return `${prefix}${line}\n`;
}

function readEnvValue(content: string, key: string): string {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = content.match(new RegExp(`^${escaped}=(.*)$`, "m"));
  if (!m) return "";
  return (m[1] || "").trim();
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
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(runnerOrigin);
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
  const required = [
    "WPDEV_ADMIN_SAVE_TOKEN",
    "WPDEV_TERMINAL_AUTH",
    "WPDEV_TERMINAL_RUNNER_TOKEN",
    "WPDEV_TERMINAL_RUNNER_ORIGIN",
  ] as const;
  const missingOrPlaceholder = required.filter((k) => {
    const v = readEnvValue(current, k);
    if (!v) return true;
    return (
      v.includes("change-me") ||
      v === "wpdev:wpdev" ||
      (k === "WPDEV_TERMINAL_RUNNER_ORIGIN" && v.includes("localhost:8888"))
    );
  });
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

async function findFreePort(startAt: number): Promise<number> {
  for (let p = startAt; p <= 65535; p++) {
    if (await isPortFree(p)) return p;
  }
  throw new Error(`Could not find a free local TCP port from ${startAt}..65535`);
}

function maybeUpdateLocalUrlPort(
  loaded: LoadedConfig,
  oldPort: number,
  newPort: number,
): void {
  const raw = loaded.config.local.url;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return;
  }
  const host = u.hostname.toLowerCase();
  const currentPort = u.port.length > 0 ? Number.parseInt(u.port, 10) : u.protocol === "https:" ? 443 : 80;
  if ((host === "localhost" || host === "127.0.0.1") && currentPort === oldPort) {
    u.port = String(newPort);
    loaded.config.local.url = u.toString().replace(/\/$/, "");
    writeWpDevConfig(loaded.configDir, loaded.config);
  }
}

function maybeUpdateRunnerOriginPort(envPath: string, oldPort: number, newPort: number): void {
  const current = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const runnerOrigin = readEnvValue(current, "WPDEV_TERMINAL_RUNNER_ORIGIN");
  if (!runnerOrigin) return;
  let u: URL;
  try {
    u = new URL(runnerOrigin);
  } catch {
    return;
  }
  const host = u.hostname.toLowerCase();
  const currentPort =
    u.port.length > 0 ? Number.parseInt(u.port, 10) : u.protocol === "https:" ? 443 : 80;
  if ((host === "localhost" || host === "127.0.0.1") && currentPort === oldPort) {
    u.port = String(newPort);
    const next = setEnvValueInContent(
      current,
      "WPDEV_TERMINAL_RUNNER_ORIGIN",
      u.toString().replace(/\/$/, ""),
    );
    writeFileSync(envPath, next.endsWith("\n") ? next : `${next}\n`, "utf8");
  }
}

async function ensureNonConflictingPublishedPorts(
  loaded: LoadedConfig,
  envPath: string,
): Promise<void> {
  const envContent = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const currentWpPort = Number.parseInt(readEnvValue(envContent, "WP_PORT") || "8888", 10);
  const currentHttpsPort = Number.parseInt(readEnvValue(envContent, "WP_HTTPS_PORT") || "8443", 10);
  const currentTerminalPort = Number.parseInt(
    readEnvValue(envContent, "WPDEV_TERMINAL_PORT") || "7681",
    10,
  );
  const currentRunnerPort = Number.parseInt(
    readEnvValue(envContent, "WPDEV_TERMINAL_RUNNER_PORT") || "7682",
    10,
  );
  const currentHostRunnerPort = Number.parseInt(
    readEnvValue(envContent, "WPDEV_HOST_RUNNER_PORT") || "7683",
    10,
  );
  const current = {
    WP_PORT: Number.isFinite(currentWpPort) && currentWpPort > 0 ? currentWpPort : 8888,
    WP_HTTPS_PORT: Number.isFinite(currentHttpsPort) && currentHttpsPort > 0 ? currentHttpsPort : 8443,
    WPDEV_TERMINAL_PORT:
      Number.isFinite(currentTerminalPort) && currentTerminalPort > 0 ? currentTerminalPort : 7681,
    WPDEV_TERMINAL_RUNNER_PORT:
      Number.isFinite(currentRunnerPort) && currentRunnerPort > 0 ? currentRunnerPort : 7682,
    WPDEV_HOST_RUNNER_PORT:
      Number.isFinite(currentHostRunnerPort) && currentHostRunnerPort > 0 ? currentHostRunnerPort : 7683,
  };

  const used = new Set<number>();
  let changed = false;

  const allocate = async (key: keyof typeof current, startAt: number): Promise<number> => {
    let candidate = startAt;
    while (candidate <= 65535) {
      if (!used.has(candidate) && (await isPortFree(candidate))) {
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
    maybeUpdateLocalUrlPort(loaded, current.WP_PORT, nextWpPort);
    maybeUpdateRunnerOriginPort(envPath, current.WP_PORT, nextWpPort);
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

/** Copy onboarding assets into wordpress/ before containers write files as www-data. */
function ensureWordPressSetupAssets(loaded: LoadedConfig): void {
  const wpRoot = resolveFromConfigDir(loaded.configDir, loaded.config.local.wpRoot);
  mkdirSync(join(wpRoot, "wp-content/mu-plugins"), { recursive: true });
  const src = join(loaded.configDir, "docker/assets/mu-plugins/wp-dev-setup.php");
  if (existsSync(src)) {
    copyFileSync(src, join(wpRoot, "wp-content/mu-plugins/wp-dev-setup.php"));
    logInfo("up: ensured wp-dev setup mu-plugin in wordpress/wp-content/mu-plugins/");
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
  console.error("Try: npm run wp-dev -- up   (retry)");
}

async function ensureAdminSaveWriteAccess(loaded: LoadedConfig): Promise<void> {
  try {
    // Best-effort: make bind-mounted admin-write targets writable for Apache/PHP in the container.
    await compose(
      loaded.configDir,
      loaded.config,
      [
        "exec",
        "-T",
        "-u",
        "0",
        "wordpress",
        "sh",
        "-lc",
        [
          "touch /wp-dev-repo/wp-dev.config.json",
          "chmod 666 /wp-dev-repo/wp-dev.config.json",
          "mkdir -p /wp-dev-repo/docker",
          "touch /wp-dev-repo/docker/.env",
          "chmod 777 /wp-dev-repo/docker",
          "chmod 666 /wp-dev-repo/docker/.env",
        ].join(" && "),
      ],
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
  ensureWordPressSetupAssets(loaded);
  const envPath = ensureComposeEnvExists(loaded);
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
    const wpPort = Number.parseInt(readEnvValue(envContent, "WP_PORT") || "8888", 10);
    const httpsPort = Number.parseInt(readEnvValue(envContent, "WP_HTTPS_PORT") || "8443", 10);
    const terminalPort = Number.parseInt(readEnvValue(envContent, "WPDEV_TERMINAL_PORT") || "7681", 10);
    const runnerPort = Number.parseInt(
      readEnvValue(envContent, "WPDEV_TERMINAL_RUNNER_PORT") || "7682",
      10,
    );
    const key =
      conflictPort === wpPort
        ? "WP_PORT"
        : conflictPort === httpsPort
          ? "WP_HTTPS_PORT"
        : conflictPort === terminalPort
          ? "WPDEV_TERMINAL_PORT"
          : conflictPort === runnerPort
            ? "WPDEV_TERMINAL_RUNNER_PORT"
            : "WP_PORT";
    const nextPort = await findFreePort(conflictPort + 1);
    setPortInEnvFile(envPath, key, nextPort);
    if (key === "WP_PORT") {
      maybeUpdateLocalUrlPort(loaded, wpPort, nextPort);
      maybeUpdateRunnerOriginPort(envPath, wpPort, nextPort);
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
  let wpInstalled: boolean | undefined;
  try {
    wpInstalled = await isLocalWpInstalled(loaded.configDir, loaded.config);
  } catch {
    wpInstalled = undefined;
  }
  printPublishedAccessUrls(loaded, wpInstalled);
}

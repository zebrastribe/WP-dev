import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { execa } from "execa";
import type { LoadedConfig } from "../config/load.js";
import type { RemoteEnvName } from "../config/schema.js";
import { getRemoteEnv } from "../config/schema.js";
import { connectSsh, type SshSession } from "./ssh.js";
import { assertRemotePathSafe } from "./remote-path-safety.js";
import { dockerComposeProjectId, getComposeProjectDir } from "./docker-compose.js";
import { posixShellQuote } from "../utils/shell-quote.js";
import { persistEnvContent, setEnvValueInContent } from "../utils/compose-env.js";
import {
  isPlaceholderRemoteHost,
  isStagingRemotePlaceholder,
} from "../utils/remote-placeholder.js";

export type ComposeProjectPeer = { configDir: string; projectId: string };

/** Another clone with the same Compose project id shares volumes and container names. */
export function foreignComposeProjectPeer(
  self: ComposeProjectPeer,
  peers: ComposeProjectPeer[],
): ComposeProjectPeer | null {
  const selfDir = resolve(self.configDir);
  for (const peer of peers) {
    if (resolve(peer.configDir) === selfDir) continue;
    if (peer.projectId === self.projectId) return peer;
  }
  return null;
}

export function assertComposeProjectsDoNotCollide(
  self: ComposeProjectPeer,
  peers: ComposeProjectPeer[],
): void {
  const hit = foreignComposeProjectPeer(self, peers);
  if (!hit) return;
  throw new Error(
    `Refusing PHP change: Compose project "${self.projectId}" is also used by ${hit.configDir}. ` +
      `Two clones with the same project id share one stack. Set a unique project id or local.composeProjectName.`,
  );
}

/** Compose working dirs that belong to this clone (config root and docker/ directory). */
export function composeDirsForClone(loaded: LoadedConfig): string[] {
  return [resolve(loaded.configDir), resolve(getComposeProjectDir(loaded.configDir, loaded.config))];
}

/** A Docker volume working dir for this project id that is not this clone. */
export function foreignComposeWorkingDir(selfDirs: string[], foundDirs: string[]): string | null {
  const self = new Set(selfDirs.map((d) => resolve(d)));
  for (const dir of foundDirs) {
    const resolved = resolve(dir);
    if (!self.has(resolved)) return dir;
  }
  return null;
}

async function discoverComposeWorkingDirs(projectId: string): Promise<string[]> {
  let listed = "";
  try {
    const r = await execa(
      "docker",
      ["volume", "ls", "-q", "--filter", `label=com.docker.compose.project=${projectId}`],
      { stdio: "pipe" },
    );
    listed = r.stdout ?? "";
  } catch {
    return [];
  }
  const names = listed.split("\n").map((s) => s.trim()).filter(Boolean);
  const dirs: string[] = [];
  for (const name of names) {
    try {
      const inspected = await execa("docker", ["volume", "inspect", name], { stdio: "pipe" });
      const parsed = JSON.parse(inspected.stdout) as Array<{ Labels?: Record<string, string> }>;
      const dir = parsed[0]?.Labels?.["com.docker.compose.project.working_dir"];
      if (dir) dirs.push(dir);
    } catch {
      /* volume gone or unreadable */
    }
  }
  return dirs;
}

/** Local Docker + remote selector allow-list. Track https://www.php.net/supported-versions.php and Docker Hub wordpress:php*-apache tags. */
export const SUPPORTED_PHP_VERSIONS = [
  "7.4",
  "8.0",
  "8.1",
  "8.2",
  "8.3",
  "8.4",
  "8.5",
] as const;
export type SupportedPhpVersion = (typeof SUPPORTED_PHP_VERSIONS)[number];

export type PhpEnvTarget = "local" | RemoteEnvName;

export type PhpStrategy = "docker_local" | "dot_php_version" | "htaccess_addhandler" | "unsupported";

export type PhpDetectResult = {
  env: PhpEnvTarget;
  currentVersion: string | null;
  strategy: PhpStrategy;
  detail: string;
  supported: boolean;
  /** False when the environment is still a template host, not a real server. */
  configured?: boolean;
};

export type PhpRollbackState = {
  env: PhpEnvTarget;
  previousVersion: string | null;
  strategy: PhpStrategy;
  files: Record<string, string | null>;
  dockerEnvPrevious?: string | null;
  at: string;
};

const HTACCESS_BEGIN = "# BEGIN WP-DEV PHP VERSION";
const HTACCESS_END = "# END WP-DEV PHP VERSION";

export function assertSupportedPhpVersion(version: string): asserts version is SupportedPhpVersion {
  if (!SUPPORTED_PHP_VERSIONS.includes(version as SupportedPhpVersion)) {
    throw new Error(
      `Unsupported PHP version "${version}". Allowed: ${SUPPORTED_PHP_VERSIONS.join(", ")}`,
    );
  }
}

function rollbackDir(configDir: string): string {
  return join(configDir, ".wp-dev", "php-rollback");
}

function rollbackPath(configDir: string, env: PhpEnvTarget): string {
  return join(rollbackDir(configDir), `${env}.json`);
}

export function readPhpRollback(configDir: string, env: PhpEnvTarget): PhpRollbackState | null {
  const path = rollbackPath(configDir, env);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as PhpRollbackState;
  } catch {
    return null;
  }
}

function writePhpRollback(configDir: string, state: PhpRollbackState): void {
  const dir = rollbackDir(configDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(rollbackPath(configDir, state.env), JSON.stringify(state, null, 2) + "\n", "utf8");
}

export function clearPhpRollback(configDir: string, env: PhpEnvTarget): void {
  const path = rollbackPath(configDir, env);
  if (existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {
      /* ignore */
    }
  }
}

function composeEnvPath(loaded: LoadedConfig): string {
  return join(loaded.configDir, loaded.config.local.path, ".env");
}

function readEnvValue(content: string, key: string): string {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = content.match(new RegExp(`^${escaped}=(.*)$`, "m"));
  if (!m) return "";
  return (m[1] || "").trim();
}

function parsePhpVersionFromOutput(text: string): string | null {
  const m = text.match(/\b(\d+\.\d+)\.\d+\b/) || text.match(/\b(\d+\.\d+)\b/);
  return m?.[1] ?? null;
}

function htaccessHandlerLine(version: SupportedPhpVersion): string {
  const compact = version.replace(".", "");
  // Common shared-hosting handlers (Simply/UnoEuro-style and cPanel-ish).
  return `AddHandler application/x-httpd-php${compact} .php`;
}

function stripWpDevHtaccessBlock(content: string): string {
  const re = new RegExp(
    `${HTACCESS_BEGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${HTACCESS_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n?`,
    "g",
  );
  return content.replace(re, "");
}

function applyWpDevHtaccessBlock(content: string, version: SupportedPhpVersion): string {
  const body = [
    HTACCESS_BEGIN,
    htaccessHandlerLine(version),
    HTACCESS_END,
    "",
  ].join("\n");
  const stripped = stripWpDevHtaccessBlock(content).replace(/\s+$/, "");
  return (stripped ? stripped + "\n\n" : "") + body;
}

export async function assertLocalDockerTags(version: SupportedPhpVersion): Promise<void> {
  const wpTag = `wordpress:php${version}-apache`;
  const cliTag = `wordpress:cli-php${version}`;
  for (const tag of [wpTag, cliTag]) {
    try {
      await execa("docker", ["manifest", "inspect", tag], { stdio: "pipe" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Docker image tag not available: ${tag}\n${msg}`);
    }
  }
}

export async function detectLocalPhp(loaded: LoadedConfig): Promise<PhpDetectResult> {
  const envPath = composeEnvPath(loaded);
  const current = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const version = readEnvValue(current, "WPDEV_PHP_VERSION") || "8.2";
  return {
    env: "local",
    currentVersion: version,
    strategy: "docker_local",
    detail: `WPDEV_PHP_VERSION in ${envPath}`,
    supported: true,
  };
}

async function remoteReadFile(ssh: SshSession, remotePath: string): Promise<string | null> {
  const q = posixShellQuote(remotePath);
  const r = await ssh.exec(
    `if [ -f ${q} ]; then cat ${q}; else echo "__WPDEV_MISSING__"; fi`,
  );
  if (r.code !== 0) return null;
  const out = r.stdout ?? "";
  if (out.trim() === "__WPDEV_MISSING__") return null;
  return out;
}

async function remoteWriteFile(ssh: SshSession, remotePath: string, content: string): Promise<void> {
  const tmp = `/tmp/wp-dev-php-${Date.now()}.txt`;
  // Avoid shell metacharacters: base64 transfer.
  const b64 = Buffer.from(content, "utf8").toString("base64");
  const qTmp = posixShellQuote(tmp);
  const qPath = posixShellQuote(remotePath);
  const wrote = await ssh.exec(
    `printf '%s' ${posixShellQuote(b64)} | base64 -d > ${qTmp} && mv ${qTmp} ${qPath}`,
  );
  if (wrote.code !== 0) {
    throw new Error(`Failed to write ${remotePath}: ${wrote.stderr || wrote.stdout}`);
  }
}

async function remotePhpVersion(ssh: SshSession, wpPath: string): Promise<string | null> {
  const q = posixShellQuote(wpPath);
  const viaWp = await ssh.exec(`cd ${q} && wp eval 'echo PHP_VERSION;' --allow-root 2>/dev/null`);
  if (viaWp.code === 0) {
    const v = parsePhpVersionFromOutput(viaWp.stdout);
    if (v) return v;
  }
  const viaCli = await ssh.exec("php -r 'echo PHP_VERSION;' 2>/dev/null");
  if (viaCli.code === 0) {
    return parsePhpVersionFromOutput(viaCli.stdout);
  }
  return null;
}

export async function detectRemotePhp(
  loaded: LoadedConfig,
  env: RemoteEnvName,
): Promise<PhpDetectResult> {
  const remote = getRemoteEnv(loaded.config, env);
  const placeholder =
    isPlaceholderRemoteHost(remote.host) ||
    (env === "staging" && isStagingRemotePlaceholder(loaded.config));
  if (placeholder) {
    const label = env === "production" ? "Production" : "Staging";
    return {
      env,
      currentVersion: null,
      strategy: "unsupported",
      supported: false,
      configured: false,
      detail: `${label} is not configured. The host is still ${remote.host}. Set the real server in Setup, then Detect again.`,
    };
  }
  const ssh = await connectSsh(remote);
  try {
    const wpPath = remote.path.replace(/\/$/, "");
    const currentVersion = await remotePhpVersion(ssh, wpPath);
    const phpVersionFile = await remoteReadFile(ssh, `${wpPath}/.php-version`);
    const htaccess = await remoteReadFile(ssh, `${wpPath}/.htaccess`);

    const canWrite = await ssh.exec(
      `touch ${posixShellQuote(`${wpPath}/.wp-dev-php-write-test`)} 2>/dev/null && rm -f ${posixShellQuote(`${wpPath}/.wp-dev-php-write-test`)} && echo ok`,
    );
    const writable = canWrite.code === 0 && (canWrite.stdout || "").includes("ok");

    if (htaccess !== null && /AddHandler\s+.*php/i.test(htaccess)) {
      if (!writable) {
        return {
          env,
          currentVersion,
          strategy: "unsupported",
          detail:
            "Host uses .htaccess PHP handlers, but the web root is not writable over SSH. Change PHP in the hosting panel.",
          supported: false,
        };
      }
      return {
        env,
        currentVersion,
        strategy: "htaccess_addhandler",
        detail: "Detected AddHandler-style .htaccess PHP selector — WP-dev can change it.",
        supported: true,
      };
    }

    if (phpVersionFile !== null) {
      if (!writable) {
        return {
          env,
          currentVersion,
          strategy: "unsupported",
          detail:
            "Found .php-version, but the web root is not writable over SSH. Change PHP in the hosting panel.",
          supported: false,
        };
      }
      return {
        env,
        currentVersion,
        strategy: "dot_php_version",
        detail: "Found .php-version (common on shared hosting) — WP-dev can update it.",
        supported: true,
      };
    }

    // Writable alone is not enough: many shared hosts ignore a newly created .php-version
    // until PHP is enabled in the panel. Prefer honest “panel only” over a fake Apply control.
    return {
      env,
      currentVersion,
      strategy: "unsupported",
      detail: writable
        ? "No .php-version or htaccess PHP selector detected. Change PHP in the hosting panel, then Refresh here to confirm."
        : "Web root not writable over SSH. Change PHP in the hosting panel, then Refresh here to confirm.",
      supported: false,
    };
  } finally {
    ssh.dispose();
  }
}

export async function detectPhp(
  loaded: LoadedConfig,
  env: PhpEnvTarget,
): Promise<PhpDetectResult> {
  if (env === "local") return detectLocalPhp(loaded);
  return detectRemotePhp(loaded, env);
}

type LocalPhpChangeOptions = {
  restart?: boolean;
  /** Tests pass known clones. The CLI leaves this unset and uses Docker volume labels. */
  peerProjects?: ComposeProjectPeer[];
  /** Tests pass [] to skip Docker. The CLI leaves this unset. */
  composeWorkingDirs?: string[];
  /** Tests skip registry lookups. The CLI must leave this unset. */
  skipImageLookup?: boolean;
};

/** Refuse a shared Compose project before this clone’s docker/.env is changed. */
async function assertLocalPhpChangeIsolated(
  loaded: LoadedConfig,
  version: SupportedPhpVersion,
  options: LocalPhpChangeOptions,
): Promise<void> {
  const projectId = dockerComposeProjectId(loaded.config);
  const peers = options.peerProjects ?? [];
  assertComposeProjectsDoNotCollide({ configDir: loaded.configDir, projectId }, peers);
  const foundDirs =
    options.composeWorkingDirs ?? (await discoverComposeWorkingDirs(projectId));
  const foreignDir = foreignComposeWorkingDir(composeDirsForClone(loaded), foundDirs);
  if (foreignDir) {
    throw new Error(
      `Refusing PHP change: Compose project "${projectId}" already has a stack at ${foreignDir}. ` +
        `That is a different clone. Set a unique project id or local.composeProjectName.`,
    );
  }
  if (!options.skipImageLookup) await assertLocalDockerTags(version);
}

/**
 * Sync warns on nested installs. A PHP selector write must not land on a tree
 * that also contains other WordPress roots.
 */
async function assertPhpRemoteTarget(
  ssh: SshSession,
  wpPath: string,
  env: string,
): Promise<void> {
  const report = await assertRemotePathSafe(ssh, wpPath, env);
  if (report.issues.some((issue) => issue.code === "nested_wp_installs")) {
    throw new Error(
      `Refusing ${env} PHP change: ${wpPath} contains nested WordPress installs. ` +
        `Point path at this site’s WordPress root only.`,
    );
  }
}

export async function setLocalPhpVersion(
  loaded: LoadedConfig,
  version: SupportedPhpVersion,
  options: LocalPhpChangeOptions = {},
): Promise<void> {
  await assertLocalPhpChangeIsolated(loaded, version, options);
  const envPath = composeEnvPath(loaded);
  const current = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const previous = readEnvValue(current, "WPDEV_PHP_VERSION") || "8.2";
  writePhpRollback(loaded.configDir, {
    env: "local",
    previousVersion: previous,
    strategy: "docker_local",
    files: {},
    dockerEnvPrevious: previous,
    at: new Date().toISOString(),
  });
  const next = setEnvValueInContent(current, "WPDEV_PHP_VERSION", version);
  persistEnvContent(envPath, next, loaded);
  console.error(`Set WPDEV_PHP_VERSION=${version} (was ${previous}).`);
  if (options.restart) {
    console.error("Restarting local Docker stack…");
    await execa("npm", ["run", "wp-dev", "--", "down"], {
      cwd: loaded.configDir,
      stdio: "inherit",
    });
    await execa("npm", ["run", "wp-dev", "--", "up"], {
      cwd: loaded.configDir,
      stdio: "inherit",
    });
  } else {
    console.error("Run: npm run wp-dev -- down && npm run wp-dev -- up");
    console.error("If anything breaks: npm run wp-dev -- php rollback --env local --restart");
  }
}

export async function setRemotePhpVersion(
  loaded: LoadedConfig,
  env: RemoteEnvName,
  version: SupportedPhpVersion,
): Promise<void> {
  const detect = await detectRemotePhp(loaded, env);
  if (!detect.supported || detect.strategy === "unsupported") {
    throw new Error(
      `Cannot change PHP on ${env} automatically: ${detect.detail}. Set PHP in the host panel, then verify with: wp-dev php show --env ${env}`,
    );
  }

  const remote = getRemoteEnv(loaded.config, env);
  const ssh = await connectSsh(remote);
  try {
    const wpPath = remote.path.replace(/\/$/, "");
    await commitRemotePhpChange({
      ssh,
      configDir: loaded.configDir,
      env,
      wpPath,
      version,
      strategy: detect.strategy === "htaccess_addhandler" ? "htaccess_addhandler" : "dot_php_version",
      previousVersion: detect.currentVersion,
    });
  } finally {
    ssh.dispose();
  }
}

export async function commitRemotePhpChange(input: {
  ssh: SshSession;
  configDir: string;
  env: RemoteEnvName;
  wpPath: string;
  version: SupportedPhpVersion;
  strategy: "dot_php_version" | "htaccess_addhandler";
  previousVersion: string | null;
}): Promise<void> {
  const { ssh, configDir, env, wpPath, version, strategy, previousVersion } = input;
  await assertPhpRemoteTarget(ssh, wpPath, env);
  const files: Record<string, string | null> = {};

  if (strategy === "dot_php_version") {
    const path = `${wpPath}/.php-version`;
    files[".php-version"] = await remoteReadFile(ssh, path);
    writePhpRollback(configDir, {
      env,
      previousVersion,
      strategy,
      files,
      at: new Date().toISOString(),
    });
    await remoteWriteFile(ssh, path, `${version}\n`);
  } else {
    const path = `${wpPath}/.htaccess`;
    const prev = (await remoteReadFile(ssh, path)) ?? "";
    files[".htaccess"] = prev;
    writePhpRollback(configDir, {
      env,
      previousVersion,
      strategy,
      files,
      at: new Date().toISOString(),
    });
    await remoteWriteFile(ssh, path, applyWpDevHtaccessBlock(prev, version));
  }

  const after = await remotePhpVersion(ssh, wpPath);
  console.error(
    `Applied PHP ${version} on ${env} via ${strategy} (CLI reports ${after ?? "unknown"}).`,
  );
  if (after && !after.startsWith(version)) {
    console.error(
      `Warning: host still reports ${after}. Selector may need panel enablement — run: wp-dev php rollback --env ${env}`,
    );
  } else {
    console.error(`Rollback available: npm run wp-dev -- php rollback --env ${env}`);
  }
}

export async function rollbackPhpVersion(
  loaded: LoadedConfig,
  env: PhpEnvTarget,
  options: LocalPhpChangeOptions = {},
): Promise<void> {
  const state = readPhpRollback(loaded.configDir, env);
  if (!state || (!state.previousVersion && Object.keys(state.files).length === 0 && !state.dockerEnvPrevious)) {
    throw new Error(`No PHP rollback snapshot for ${env}. Nothing to restore.`);
  }

  if (env === "local") {
    const prev = state.dockerEnvPrevious || state.previousVersion || "8.2";
    assertSupportedPhpVersion(prev);
    await assertLocalPhpChangeIsolated(loaded, prev, options);
    const envPath = composeEnvPath(loaded);
    const current = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
    const next = setEnvValueInContent(current, "WPDEV_PHP_VERSION", prev);
    persistEnvContent(envPath, next, loaded);
    console.error(`Restored WPDEV_PHP_VERSION=${prev}.`);
    if (options.restart) {
      await execa("npm", ["run", "wp-dev", "--", "down"], {
        cwd: loaded.configDir,
        stdio: "inherit",
      });
      await execa("npm", ["run", "wp-dev", "--", "up"], {
        cwd: loaded.configDir,
        stdio: "inherit",
      });
    } else {
      console.error("Run: npm run wp-dev -- down && npm run wp-dev -- up");
    }
    clearPhpRollback(loaded.configDir, env);
    return;
  }

  const remote = getRemoteEnv(loaded.config, env);
  const ssh = await connectSsh(remote);
  try {
    const wpPath = remote.path.replace(/\/$/, "");
    await assertPhpRemoteTarget(ssh, wpPath, env);
    for (const [rel, content] of Object.entries(state.files)) {
      const path = `${wpPath}/${rel}`;
      if (content === null) {
        await ssh.exec(`rm -f ${posixShellQuote(path)}`);
      } else {
        await remoteWriteFile(ssh, path, content);
      }
    }
    const after = await remotePhpVersion(ssh, wpPath);
    console.error(
      `Rolled back PHP selector on ${env} (CLI reports ${after ?? "unknown"}; previous recorded ${state.previousVersion ?? "n/a"}).`,
    );
  } finally {
    ssh.dispose();
  }
  clearPhpRollback(loaded.configDir, env);
}

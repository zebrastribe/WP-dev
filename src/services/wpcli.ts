import {
  copyFileSync,
  createReadStream,
  existsSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { execa } from "execa";
import type { RemoteEnvConfig, WpDevConfig } from "../config/schema.js";
import type { SshSession } from "./ssh.js";
import {
  dockerComposeProjectId,
  getComposeProjectDir,
  getDockerComposeLeadArgs,
} from "./docker-compose.js";
import { resolveFromConfigDir } from "../config/load.js";
import { persistEnvContent, setEnvValueInContent, writeEnvFile } from "../utils/compose-env.js";
import { posixShellArg, posixShellQuote } from "../utils/shell-quote.js";
import { sanitizeCliError } from "../utils/sanitize-cli-error.js";

const CONTAINER_WP_PATH = "/var/www/html";

export type WpLocalRawOptions = {
  input?: Readable | Buffer;
  /** Run the wpcli container as root so it can edit wp-config.php after host-owned chown (fix-permissions). */
  runUserRoot?: boolean;
};

export async function wpLocalRaw(
  configDir: string,
  config: WpDevConfig,
  wpArgs: string[],
  execOptions: WpLocalRawOptions = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const projectDir = getComposeProjectDir(configDir, config);
  const service = config.local.composeService;
  const composeLead = [
    ...getDockerComposeLeadArgs(config),
  ];
  const runArgs = [
    "run",
    "--rm",
    "-e",
    "HTTP_HOST=localhost",
    "-e",
    "REQUEST_URI=/",
    "-e",
    "HTTPS=off",
    ...(execOptions.runUserRoot ? (["--user", "0"] as const) : []),
    "-T",
    service,
    "wp",
    ...wpArgs,
    ...(execOptions.runUserRoot ? (["--allow-root"] as const) : []),
    `--path=${CONTAINER_WP_PATH}`,
  ];
  let r = await execa("docker", [...composeLead, ...runArgs], {
    cwd: projectDir,
    reject: false,
    ...(execOptions.input !== undefined ? { input: execOptions.input } : {}),
  });
  const composePluginBroken =
    r.exitCode !== 0 &&
    (r.stderr.includes("Invalid Plugins:") ||
      r.stderr.includes("unknown shorthand flag: 'p' in -p") ||
      r.stdout.includes("Invalid Plugins:") ||
      r.stdout.includes("unknown shorthand flag: 'p' in -p"));
  if (composePluginBroken) {
    const fallbackLead = [
      "-p",
      dockerComposeProjectId(config),
      "-f",
      config.local.composeFile,
    ];
    r = await execa("docker-compose", [...fallbackLead, ...runArgs], {
      cwd: projectDir,
      reject: false,
      ...(execOptions.input !== undefined ? { input: execOptions.input } : {}),
    });
  }
  return {
    stdout: typeof r.stdout === "string" ? r.stdout : String(r.stdout ?? ""),
    stderr: typeof r.stderr === "string" ? r.stderr : String(r.stderr ?? ""),
    exitCode: r.exitCode ?? 1,
  };
}

const MYSQL_READY_MAX_ATTEMPTS = 45;
const MYSQL_READY_INTERVAL_MS = 2000;

async function tryLocalMysqlPing(
  configDir: string,
  config: WpDevConfig,
): Promise<boolean> {
  const projectDir = getComposeProjectDir(configDir, config);
  const r = await execa(
    "docker",
    [
      ...getDockerComposeLeadArgs(config),
      "exec",
      "-T",
      "db",
      "sh",
      "-c",
      'mysqladmin ping -h localhost -uroot -p"$MYSQL_ROOT_PASSWORD"',
    ],
    { cwd: projectDir, reject: false },
  );
  return r.exitCode === 0;
}

/** Waits until the Compose `db` container accepts connections (after `up` / volume recreate). */
export async function waitForLocalMysqlReady(
  configDir: string,
  config: WpDevConfig,
): Promise<void> {
  for (let i = 0; i < MYSQL_READY_MAX_ATTEMPTS; i++) {
    if (await tryLocalMysqlPing(configDir, config)) return;
    await delay(MYSQL_READY_INTERVAL_MS);
  }
  throw new Error(
    "Local MySQL did not become ready in time. Is `wp-dev up` running and the `db` container healthy? Check docker/.env credentials.",
  );
}

/** True when local WP-CLI sees an installed site (Docker reachable, DB up, core installed). */
export async function isLocalWpInstalled(
  configDir: string,
  config: WpDevConfig,
): Promise<boolean> {
  const r = await wpLocalRaw(configDir, config, ["core", "is-installed"]);
  return r.exitCode === 0;
}

export async function assertLocalWpInstalled(
  configDir: string,
  config: WpDevConfig,
): Promise<void> {
  if (!(await isLocalWpInstalled(configDir, config))) {
    const inContainerNoDockerSocket =
      existsSync("/.dockerenv") && !existsSync("/var/run/docker.sock");
    if (inContainerNoDockerSocket) {
      throw new Error(
        "This command must run on your host terminal, not inside the browser terminal container. Open a host shell and run: `npm run wp-dev -- push staging` from the project directory.",
      );
    }
    throw new Error(
      "Local WordPress is not installed or docker services are not running. Run `wp-dev up` and complete the WordPress install (or pull from remote) first.",
    );
  }
}

export async function assertRemoteWpInstalled(
  ssh: SshSession,
  remotePath: string,
): Promise<void> {
  const check = await resolveRemoteWpPath(ssh, remotePath);
  if (!check.installed) {
    throw new Error(
      `Remote WordPress not found or WP-CLI failed at path: ${remotePath}. stderr: ${check.stderr ?? ""}${check.hint ?? ""}`,
    );
  }
}

export async function resolveRemoteWpPath(
  ssh: SshSession,
  remotePath: string,
): Promise<{ installed: boolean; path?: string; stderr?: string; hint?: string }> {
  const base = remotePath.replace(/\/$/, "");
  const rel = base.replace(/^\/+/, "");
  const candidates = Array.from(
    new Set([base, rel, `${base}/public_html`, `${rel}/public_html`].filter(Boolean)),
  );

  let firstErr = "";
  for (const p of candidates) {
    const r = await ssh.exec(`wp core is-installed ${remoteWpPathFlag(p)}`);
    if (!firstErr) firstErr = r.stderr ?? "";
    if (r.code === 0) {
      return { installed: true, path: p };
    }
  }
  return {
    installed: false,
    stderr: firstErr,
    hint:
      `\nHint: No WordPress install detected at ${candidates.join(", ")}. ` +
      `For first-time staging setup, run push staging once to seed files, complete the remote WordPress installer, then run push staging again.`,
  };
}

/**
 * Remote `wp --path=…` fragment. Single-quoted POSIX paths only; never wrap in double quotes
 * or WP-CLI receives quote characters inside the path value.
 */
export function remoteWpPathFlag(remotePath: string): string {
  return `--path=${posixShellQuote(remotePath)}`;
}

export async function wpRemoteExec(
  ssh: SshSession,
  remotePath: string,
  wpArgs: string[],
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const inner = wpArgs.map(posixShellArg).join(" ");
  return ssh.exec(`wp ${inner} ${remoteWpPathFlag(remotePath)}`);
}

export async function wpRemoteDbExport(
  ssh: SshSession,
  remotePath: string,
  remoteSqlPath: string,
): Promise<void> {
  const r = await wpRemoteExec(ssh, remotePath, [
    "db",
    "export",
    remoteSqlPath,
  ]);
  if (r.code !== 0) {
    throw new Error(`Remote wp db export failed: ${r.stderr || r.stdout}`);
  }
}

export async function wpRemoteDbImport(
  ssh: SshSession,
  remotePath: string,
  remoteSqlPath: string,
): Promise<void> {
  const r = await wpRemoteExec(ssh, remotePath, [
    "db",
    "import",
    remoteSqlPath,
  ]);
  if (r.code !== 0) {
    throw new Error(`Remote wp db import failed: ${r.stderr || r.stdout}`);
  }
}

export async function wpRemoteSearchReplace(
  ssh: SshSession,
  remotePath: string,
  from: string,
  to: string,
): Promise<void> {
  const r = await wpRemoteExec(ssh, remotePath, [
    "search-replace",
    from,
    to,
    "--skip-columns=guid",
    "--precise",
  ]);
  if (r.code !== 0) {
    throw new Error(`Remote wp search-replace failed: ${r.stderr || r.stdout}`);
  }
}

export async function wpRemoteForceSiteUrls(
  ssh: SshSession,
  remotePath: string,
  url: string,
): Promise<void> {
  for (const key of ["home", "siteurl"] as const) {
    const r = await wpRemoteExec(ssh, remotePath, ["option", "update", key, url]);
    if (r.code !== 0) {
      throw new Error(`Remote wp option update ${key} failed: ${r.stderr || r.stdout}`);
    }
  }
}

export async function wpLocalForceSiteUrls(
  configDir: string,
  config: WpDevConfig,
  url: string,
): Promise<void> {
  for (const key of ["home", "siteurl"] as const) {
    const r = await wpLocalRaw(configDir, config, ["option", "update", key, url]);
    if (r.exitCode !== 0) {
      throw new Error(`Local wp option update ${key} failed: ${r.stderr || r.stdout}`);
    }
  }
}

export async function wpLocalGetTablePrefix(
  configDir: string,
  config: WpDevConfig,
): Promise<string | undefined> {
  const r = await wpLocalRaw(configDir, config, ["config", "get", "table_prefix", "--type=variable"]);
  if (r.exitCode !== 0) return undefined;
  const prefix = (r.stdout || "").trim();
  return prefix !== "" ? prefix : undefined;
}

export async function wpRemoteBootstrapConfigFromRemoteDb(
  ssh: SshSession,
  remotePath: string,
  remote: RemoteEnvConfig,
  fallbackTablePrefix?: string,
): Promise<string> {
  if (!remote.db) {
    throw new Error(
      `Remote DB settings are missing for ${remotePath}. Add staging.db/production.db in wp-dev.config.json to enable first-time bootstrap.`,
    );
  }
  const dbPrefix = remote.db.prefix?.trim() || fallbackTablePrefix || "wp_";
  const base = remotePath.replace(/\/$/, "");
  const rel = base.replace(/^\/+/, "");
  const candidates = Array.from(
    new Set([base, rel, `${base}/public_html`, `${rel}/public_html`].filter(Boolean)),
  );
  let lastErr = "";
  for (const p of candidates) {
    const r = await wpRemoteExec(ssh, p, [
      "config",
      "create",
      `--dbname=${remote.db.name}`,
      `--dbuser=${remote.db.user}`,
      `--dbpass=${remote.db.password}`,
      `--dbhost=${remote.db.host}`,
      `--dbprefix=${dbPrefix}`,
      "--skip-check",
      "--force",
    ]);
    if (r.code === 0) return p;
    lastErr = sanitizeCliError(r.stderr || r.stdout);
  }
  throw new Error(
    `Remote wp config create failed at ${remotePath}: ${lastErr}. ` +
      `Verify staging.db settings and remote path.`,
  );
}

function upsertDotenvKey(envPath: string, key: string, value: string): void {
  const current = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const next = setEnvValueInContent(current, key, value);
  persistEnvContent(envPath, next);
}

function ensureComposeDotenv(configDir: string, config: WpDevConfig): string {
  const projectDir = getComposeProjectDir(configDir, config);
  const envPath = join(projectDir, ".env");
  if (existsSync(envPath)) return envPath;
  const example = join(projectDir, ".env.example");
  if (existsSync(example)) {
    copyFileSync(example, envPath);
    return envPath;
  }
  writeEnvFile(envPath, "WP_PORT=8888\n");
  return envPath;
}

/**
 * After importing a remote dump, align local `$table_prefix` and Compose env so WP-CLI
 * (search-replace, etc.) matches the imported tables. Pull excludes wp-config.php from rsync.
 */
export async function wpLocalAlignTablePrefixAfterImport(
  configDir: string,
  config: WpDevConfig,
  tablePrefix: string,
): Promise<void> {
  await waitForLocalMysqlReady(configDir, config);
  const envPath = ensureComposeDotenv(configDir, config);
  upsertDotenvKey(envPath, "WORDPRESS_TABLE_PREFIX", tablePrefix);

  let r = await wpLocalRaw(
    configDir,
    config,
    ["config", "set", "table_prefix", tablePrefix, "--type=variable"],
    { runUserRoot: true },
  );
  if (r.exitCode !== 0) {
    r = await wpLocalRaw(
      configDir,
      config,
      ["config", "set", "table_prefix", tablePrefix],
      { runUserRoot: true },
    );
  }
  if (r.exitCode !== 0) {
    throw new Error(
      `Could not set local table_prefix to "${tablePrefix}" (wp config set failed). stderr: ${r.stderr || r.stdout}\n` +
        `Set WORDPRESS_TABLE_PREFIX=${tablePrefix} in docker/.env, run wp-dev down && wp-dev up, then pull again.`,
    );
  }
}

export async function wpLocalDbImportFromFile(
  configDir: string,
  config: WpDevConfig,
  hostSqlPath: string,
): Promise<void> {
  await waitForLocalMysqlReady(configDir, config);
  const stream = createReadStream(hostSqlPath);
  const r = await wpLocalRaw(configDir, config, ["db", "import", "-"], {
    input: stream,
  });
  if (r.exitCode !== 0) {
    throw new Error(`Local wp db import failed: ${r.stderr || r.stdout}`);
  }
}

/** Export DB to a host path by writing via the bind-mounted wp root (handles large dumps). */
export async function wpLocalDbExportToFile(
  configDir: string,
  config: WpDevConfig,
  hostSqlPath: string,
): Promise<void> {
  await waitForLocalMysqlReady(configDir, config);
  const fileName = `.wp-dev-export-${Date.now()}.sql`;
  const containerPath = `${CONTAINER_WP_PATH}/${fileName}`;
  // Export as root so temporary dump file can always be created on bind-mounted wp root.
  const r = await wpLocalRaw(configDir, config, ["db", "export", containerPath], {
    runUserRoot: true,
  });
  if (r.exitCode !== 0) {
    throw new Error(`Local wp db export failed: ${r.stderr || r.stdout}`);
  }
  const mounted = resolveFromConfigDir(configDir, join(config.local.wpRoot, fileName));
  try {
    copyFileSync(mounted, hostSqlPath);
  } finally {
    try {
      unlinkSync(mounted);
    } catch {
      /* cleanup */
    }
  }
}

export async function wpLocalSearchReplace(
  configDir: string,
  config: WpDevConfig,
  from: string,
  to: string,
): Promise<void> {
  const r = await wpLocalSearchReplaceRaw(configDir, config, from, to, false);
  if (r.exitCode !== 0) {
    throw new Error(`Local wp search-replace failed: ${r.stderr || r.stdout}`);
  }
}

export function parseSearchReplaceReplacementCount(stdout: string): number {
  const m = (stdout || "").match(/Made (\d+) replacements?/i);
  if (!m) return 0;
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) ? n : 0;
}

async function wpLocalSearchReplaceRaw(
  configDir: string,
  config: WpDevConfig,
  from: string,
  to: string,
  regex: boolean,
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const args = ["search-replace", from, to, "--skip-columns=guid", "--precise"];
  if (regex) args.push("--regex");
  const r = await wpLocalRaw(configDir, config, args);
  return {
    exitCode: r.exitCode,
    stdout: r.stdout || "",
    stderr: r.stderr || "",
  };
}

/** Regex search-replace in the local DB; returns WP-CLI replacement count. */
export async function wpLocalSearchReplaceRegex(
  configDir: string,
  config: WpDevConfig,
  pattern: string,
  replacement: string,
): Promise<number> {
  const r = await wpLocalSearchReplaceRaw(configDir, config, pattern, replacement, true);
  if (r.exitCode !== 0) {
    throw new Error(`Local wp search-replace (regex) failed: ${r.stderr || r.stdout}`);
  }
  return parseSearchReplaceReplacementCount(r.stdout);
}

import {
  copyFileSync,
  createReadStream,
  existsSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { execa } from "execa";
import type { WpDevConfig } from "../config/schema.js";
import type { SshSession } from "./ssh.js";
import {
  getComposeProjectDir,
  getDockerComposeLeadArgs,
} from "./docker-compose.js";
import { resolveFromConfigDir } from "../config/load.js";

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
  const args = [
    ...getDockerComposeLeadArgs(config),
    "run",
    "--rm",
    ...(execOptions.runUserRoot ? (["--user", "0"] as const) : []),
    "-T",
    service,
    "wp",
    ...wpArgs,
    `--path=${CONTAINER_WP_PATH}`,
  ];
  const r = await execa("docker", args, {
    cwd: projectDir,
    reject: false,
    ...(execOptions.input !== undefined ? { input: execOptions.input } : {}),
  });
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
    throw new Error(
      "Local WordPress is not installed or docker services are not running. Run `wp-dev up` and complete the WordPress install (or pull from remote) first.",
    );
  }
}

export async function assertRemoteWpInstalled(
  ssh: SshSession,
  remotePath: string,
): Promise<void> {
  const r = await ssh.exec(`wp core is-installed ${remoteWpPathFlag(remotePath)}`);
  if (r.code !== 0) {
    const base = remotePath.replace(/\/$/, "");
    const alt = `${base}/public_html`;
    const altCheck = await ssh.exec(`wp core is-installed ${remoteWpPathFlag(alt)}`);
    let hint = "";
    if (altCheck.code === 0) {
      hint =
        `\nHint: WordPress seems installed at ${alt}. ` +
        `Update staging.path/production.path in wp-dev.config.json to that path.`;
    } else {
      hint =
        `\nHint: ${remotePath} appears to be a folder mapping without a WordPress install yet. ` +
        `wp-dev push requires remote WP-CLI to work and keeps remote wp-config.php (rsync excludes it). ` +
        `Install WordPress in that folder first, or point path to an existing install.`;
    }
    throw new Error(
      `Remote WordPress not found or WP-CLI failed at path: ${remotePath}. stderr: ${r.stderr}${hint}`,
    );
  }
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Remote `wp --path=…` fragment. Single-quoted POSIX paths only; never wrap in double quotes
 * or WP-CLI receives quote characters inside the path value.
 */
export function remoteWpPathFlag(remotePath: string): string {
  return `--path=${shellQuote(remotePath)}`;
}

export async function wpRemoteExec(
  ssh: SshSession,
  remotePath: string,
  wpArgs: string[],
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const inner = wpArgs.map(shellArg).join(" ");
  return ssh.exec(`wp ${inner} ${remoteWpPathFlag(remotePath)}`);
}

function shellArg(s: string): string {
  if (/^[a-zA-Z0-9/._:-]+$/.test(s)) return s;
  return shellQuote(s);
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
  ]);
  if (r.code !== 0) {
    throw new Error(`Remote wp search-replace failed: ${r.stderr || r.stdout}`);
  }
}

function upsertDotenvKey(envPath: string, key: string, value: string): void {
  const line = `${key}=${value}`;
  const current = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^${escapedKey}=.*$`, "m");
  if (re.test(current)) {
    const next = current.replace(re, line);
    writeFileSync(envPath, next.endsWith("\n") ? next : `${next}\n`, "utf8");
    return;
  }
  const prefix = current.trim().length > 0 ? `${current.replace(/\s*$/, "")}\n` : "";
  writeFileSync(envPath, `${prefix}${line}\n`, "utf8");
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
  writeFileSync(envPath, "WP_PORT=8888\n", "utf8");
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
  const r = await wpLocalRaw(configDir, config, ["db", "export", containerPath]);
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
  const r = await wpLocalRaw(configDir, config, [
    "search-replace",
    from,
    to,
    "--skip-columns=guid",
  ]);
  if (r.exitCode !== 0) {
    throw new Error(`Local wp search-replace failed: ${r.stderr || r.stdout}`);
  }
}

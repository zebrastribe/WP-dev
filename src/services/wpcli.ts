import { copyFileSync, createReadStream, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { execa } from "execa";
import type { WpflowConfig } from "../config/schema.js";
import type { SshSession } from "./ssh.js";
import {
  getComposeProjectDir,
  getDockerComposeLeadArgs,
} from "./docker-compose.js";
import { resolveFromConfigDir } from "../config/load.js";

const CONTAINER_WP_PATH = "/var/www/html";

export async function wpLocalRaw(
  configDir: string,
  config: WpflowConfig,
  wpArgs: string[],
  execOptions: { input?: Readable | Buffer } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const projectDir = getComposeProjectDir(configDir, config);
  const service = config.local.composeService;
  const args = [
    ...getDockerComposeLeadArgs(config),
    "run",
    "--rm",
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

export async function assertLocalWpInstalled(
  configDir: string,
  config: WpflowConfig,
): Promise<void> {
  const r = await wpLocalRaw(configDir, config, ["core", "is-installed"]);
  if (r.exitCode !== 0) {
    throw new Error(
      "Local WordPress is not installed or docker services are not running. Run `wpflow up` and complete the WordPress install (or pull from remote) first.",
    );
  }
}

export async function assertRemoteWpInstalled(
  ssh: SshSession,
  remotePath: string,
): Promise<void> {
  const r = await ssh.exec(
    `wp core is-installed --path="${shellQuote(remotePath)}"`,
  );
  if (r.code !== 0) {
    throw new Error(
      `Remote WordPress not found or WP-CLI failed at path: ${remotePath}. stderr: ${r.stderr}`,
    );
  }
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export async function wpRemoteExec(
  ssh: SshSession,
  remotePath: string,
  wpArgs: string[],
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const inner = wpArgs.map(shellArg).join(" ");
  return ssh.exec(`wp ${inner} --path=${shellQuote(remotePath)}`);
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

export async function wpLocalDbImportFromFile(
  configDir: string,
  config: WpflowConfig,
  hostSqlPath: string,
): Promise<void> {
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
  config: WpflowConfig,
  hostSqlPath: string,
): Promise<void> {
  const fileName = `.wpflow-export-${Date.now()}.sql`;
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
  config: WpflowConfig,
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

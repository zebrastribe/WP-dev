import { chownSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RemoteEnvName } from "../config/schema.js";
import { resolveHostIdentity } from "../utils/host-paths.js";

export function backupDirFor(project: string, env: RemoteEnvName | "local"): string {
  return join(homedir(), ".wp-dev", "backups", project, env);
}

/**
 * When CLI runs as root inside the terminal container, backup files land on the
 * host bind as root-owned. Re-own to the workstation user so host tools can read them.
 */
export function chownBackupArtifact(path: string, configDir = process.cwd()): void {
  try {
    const { uid, gid } = resolveHostIdentity(configDir);
    chownSync(path, uid, gid);
  } catch {
    /* ignore: non-posix or permission denied */
  }
}

export function ensureBackupDir(project: string, env: RemoteEnvName | "local"): string {
  const dir = backupDirFor(project, env);
  mkdirSync(dir, { recursive: true });
  chownBackupArtifact(dir);
  return dir;
}

function stampParts(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  const rand = Math.random().toString(36).slice(2, 8);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}-${ms}-${rand}`;
}

export function timestampedDbName(): string {
  return `db-${stampParts()}.sql`;
}

export function timestampedFullName(): string {
  return `full-${stampParts()}.tar.gz`;
}

export function timestampedPreRestoreName(): string {
  return `pre-restore-${stampParts()}.sql`;
}

export function assertBackupFileExists(path: string): void {
  if (!existsSync(path)) {
    throw new Error(`Backup file not found: ${path}`);
  }
}

import { mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RemoteEnvName } from "../config/schema.js";

export function backupDirFor(project: string, env: RemoteEnvName | "local"): string {
  return join(homedir(), ".wp-dev", "backups", project, env);
}

export function ensureBackupDir(project: string, env: RemoteEnvName | "local"): string {
  const dir = backupDirFor(project, env);
  mkdirSync(dir, { recursive: true });
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

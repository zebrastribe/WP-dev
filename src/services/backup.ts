import { mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RemoteEnvName } from "../config/schema.js";

export function backupDirFor(project: string, env: RemoteEnvName | "local"): string {
  return join(homedir(), ".wpflow", "backups", project, env);
}

export function ensureBackupDir(project: string, env: RemoteEnvName | "local"): string {
  const dir = backupDirFor(project, env);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function timestampedDbName(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `db-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}-${p(d.getMinutes())}.sql`;
}

export function assertBackupFileExists(path: string): void {
  if (!existsSync(path)) {
    throw new Error(`Backup file not found: ${path}`);
  }
}

import { existsSync, readFileSync, unlinkSync, writeFileSync, mkdirSync, openSync, closeSync } from "node:fs";
import { join } from "node:path";

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function updateLockPath(configDir: string): string {
  return join(configDir, "logs", "wp-dev-update.lock");
}

export function readUpdateLock(configDir: string): { pid: number; startedAt: string } | null {
  const path = updateLockPath(configDir);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as { pid: number; startedAt: string };
  } catch {
    return null;
  }
}

export function acquireUpdateLock(configDir: string): boolean {
  const path = updateLockPath(configDir);
  mkdirSync(join(configDir, "logs"), { recursive: true });
  const stale = readUpdateLock(configDir);
  if (stale && isPidAlive(stale.pid)) return false;
  if (stale) {
    try {
      unlinkSync(path);
    } catch {
      /* ignore */
    }
  }
  try {
    const fd = openSync(path, "wx");
    writeFileSync(fd, `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`);
    closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

export function releaseUpdateLock(configDir: string): void {
  const path = updateLockPath(configDir);
  if (!existsSync(path)) return;
  try {
    unlinkSync(path);
  } catch {
    /* ignore */
  }
}

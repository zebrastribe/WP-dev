import {
  openSync,
  closeSync,
  unlinkSync,
  mkdirSync,
  existsSync,
  readFileSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const STALE_MS = 2 * 60 * 60 * 1000;

function lockPath(projectId: string): string {
  const dir = join(homedir(), ".wp-dev", "locks");
  mkdirSync(dir, { recursive: true });
  const key = (projectId.trim() || "default").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 120);
  return join(dir, `sync-project-${key}.lock`);
}

export type SyncLockHandle = { path: string; fd: number };

/**
 * Exclusive lock for pull/push/restore so UI + CLI cannot race the same project.
 * Keyed by config.project (not configDir) so host CLI and container runners share one lock.
 * Uses O_EXCL; stale locks older than 2h are removed.
 */
export function acquireSyncLock(projectId: string, op: string): SyncLockHandle {
  const path = lockPath(projectId);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, "wx");
      writeSync(fd, JSON.stringify({ pid: process.pid, op, at: new Date().toISOString() }));
      return { path, fd };
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code !== "EEXIST") throw e;
      try {
        if (existsSync(path)) {
          const raw = readFileSync(path, "utf8");
          const parsed = JSON.parse(raw) as { at?: string; op?: string; pid?: number };
          const at = parsed.at ? Date.parse(parsed.at) : 0;
          if (at && Date.now() - at > STALE_MS) {
            unlinkSync(path);
            continue;
          }
          throw new Error(
            `Another sync is in progress (${parsed.op ?? "unknown"}, pid ${parsed.pid ?? "?"}). Wait or remove ${path} if stuck.`,
          );
        }
      } catch (inner) {
        if (inner instanceof Error && /Another sync/.test(inner.message)) throw inner;
        try {
          unlinkSync(path);
        } catch {
          /* ignore */
        }
      }
    }
  }
  throw new Error(`Could not acquire sync lock at ${path}`);
}

export function releaseSyncLock(lock: SyncLockHandle | null): void {
  if (!lock) return;
  try {
    closeSync(lock.fd);
  } catch {
    /* ignore */
  }
  try {
    unlinkSync(lock.path);
  } catch {
    /* ignore */
  }
}

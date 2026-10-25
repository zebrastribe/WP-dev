import {
  openSync,
  closeSync,
  unlinkSync,
  mkdirSync,
  existsSync,
  readFileSync,
  writeSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { homedir, hostname } from "node:os";
import { randomBytes } from "node:crypto";

/** Cross-namespace reclaim only (host CLI vs container). Same-host reclaim uses PID only. */
const CROSS_NS_STALE_MS = 2 * 60 * 60 * 1000;
/** Empty/torn lock from a crashed create — reclaim after this age. */
const TORN_EMPTY_MS = 15_000;

export type SyncLockPayload = {
  pid: number;
  op: string;
  at: string;
  token: string;
  /** os.hostname() — PID liveness is only meaningful when this matches. */
  host: string;
};

export type SyncLockHandle = {
  path: string;
  fd: number;
  pid: number;
  token: string;
};

function lockPath(projectId: string): string {
  const dir = join(homedir(), ".wp-dev", "locks");
  mkdirSync(dir, { recursive: true });
  const key = (projectId.trim() || "default").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 120);
  return join(dir, `sync-project-${key}.lock`);
}

/** True if the process that wrote the lock is still running (same PID namespace only). */
export function isLockPidAlive(pid: number | undefined): boolean {
  if (pid == null || !Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function parseSyncLockPayload(raw: string): SyncLockPayload | null {
  try {
    const parsed = JSON.parse(raw) as Partial<SyncLockPayload>;
    if (
      typeof parsed.pid !== "number" ||
      typeof parsed.op !== "string" ||
      typeof parsed.at !== "string" ||
      typeof parsed.token !== "string" ||
      typeof parsed.host !== "string"
    ) {
      return null;
    }
    return {
      pid: parsed.pid,
      op: parsed.op,
      at: parsed.at,
      token: parsed.token,
      host: parsed.host,
    };
  } catch {
    return null;
  }
}

/**
 * Whether an existing lock may be unlinked so a new acquire can proceed.
 * Same host: reclaim only when the recorded PID is dead (never age-only while alive).
 * Other host / container NS: reclaim only after CROSS_NS_STALE_MS (PID check is meaningless).
 */
export function canReclaimSyncLock(
  payload: SyncLockPayload,
  nowMs: number = Date.now(),
  currentHost: string = hostname(),
): boolean {
  const ageMs = nowMs - Date.parse(payload.at);
  const agedCrossNs = Number.isFinite(ageMs) && ageMs > CROSS_NS_STALE_MS;
  if (payload.host === currentHost) {
    return !isLockPidAlive(payload.pid);
  }
  return agedCrossNs;
}

function tryReclaimTornEmpty(path: string, nowMs: number): boolean {
  try {
    const st = statSync(path);
    if (st.size > 0) return false;
    if (nowMs - st.mtimeMs < TORN_EMPTY_MS) return false;
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Exclusive lock for pull/push/restore so UI + CLI cannot race the same project.
 * Keyed by config.project (not configDir) so host CLI and container runners share one lock file
 * via the ~/.wp-dev bind mount.
 *
 * Create is O_EXCL + immediate write (no empty-file steal window after return).
 * Corrupt JSON is never unlinked (manual recovery). Empty torn files reclaim after 15s.
 */
export function acquireSyncLock(projectId: string, op: string): SyncLockHandle {
  const path = lockPath(projectId);
  const currentHost = hostname();
  const nowIso = () => new Date().toISOString();

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const token = randomBytes(16).toString("hex");
      const payload: SyncLockPayload = {
        pid: process.pid,
        op,
        at: nowIso(),
        token,
        host: currentHost,
      };
      const fd = openSync(path, "wx");
      try {
        writeSync(fd, JSON.stringify(payload));
      } catch (writeErr) {
        try {
          closeSync(fd);
        } catch {
          /* ignore */
        }
        try {
          unlinkSync(path);
        } catch {
          /* ignore */
        }
        throw writeErr;
      }
      return { path, fd, pid: process.pid, token };
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code !== "EEXIST") throw e;

      if (!existsSync(path)) continue;

      const raw = readFileSync(path, "utf8");
      if (raw.trim() === "") {
        if (tryReclaimTornEmpty(path, Date.now())) continue;
        throw new Error(
          `Sync lock exists but is empty (another process may be starting). Retry shortly or remove ${path} if stuck.`,
        );
      }

      const parsed = parseSyncLockPayload(raw);
      if (!parsed) {
        throw new Error(
          `Sync lock at ${path} is corrupt or incomplete. If no sync is running, remove that file and retry.`,
        );
      }

      if (canReclaimSyncLock(parsed, Date.now(), currentHost)) {
        try {
          unlinkSync(path);
        } catch {
          /* raced */
        }
        continue;
      }

      throw new Error(
        `Another sync is in progress (${parsed.op}, pid ${parsed.pid}, host ${parsed.host}). Wait or remove ${path} if stuck.`,
      );
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
    if (!existsSync(lock.path)) return;
    const parsed = parseSyncLockPayload(readFileSync(lock.path, "utf8"));
    // Only unlink if we still own the lock (prevents deleting a successor's lock).
    if (!parsed || parsed.token !== lock.token || parsed.pid !== lock.pid) {
      return;
    }
    unlinkSync(lock.path);
  } catch {
    /* ignore */
  }
}

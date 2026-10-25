import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import type { SshSession } from "../services/ssh.js";

/** Silent preflight: throw only when there is not enough free space. */

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let n = bytes;
  let i = -1;
  do {
    n /= 1024;
    i += 1;
  } while (n >= 1024 && i < units.length - 1);
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Free bytes for the filesystem containing `path` (`df -Pk`).
 * Returns null if df is unavailable or unparseable (caller may skip).
 */
export function getFreeBytes(path: string): number | null {
  const probe = existsSync(path) ? path : dirname(path);
  try {
    if (!existsSync(probe)) mkdirSync(probe, { recursive: true });
  } catch {
    /* still try df on parent */
  }
  try {
    const out = execFileSync("df", ["-Pk", probe], {
      encoding: "utf8",
      maxBuffer: 1024 * 64,
    });
    return parseDfAvailableBytes(out);
  } catch {
    return null;
  }
}

/** Parse GNU/BSD `df -Pk` output → Available column in bytes. */
export function parseDfAvailableBytes(dfOutput: string): number | null {
  const lines = dfOutput
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return null;
  const header = lines[0]!.toLowerCase();
  const availIdx = header.split(/\s+/).findIndex((c) => c === "available" || c === "avail");
  // Prefer the last line that looks like a df data row (handles wrapped device names).
  for (let i = lines.length - 1; i >= 1; i -= 1) {
    const cols = lines[i]!.split(/\s+/).filter(Boolean);
    const raw =
      availIdx >= 0 && cols[availIdx] != null && /^\d+$/.test(cols[availIdx]!)
        ? cols[availIdx]
        : cols.length >= 4 && /^\d+$/.test(cols[cols.length - 3] ?? "")
          ? cols[cols.length - 3]
          : null;
    if (raw != null) {
      // df -Pk reports 1024-byte blocks
      return Number(raw) * 1024;
    }
  }
  return null;
}

export async function getRemoteFreeBytes(
  ssh: SshSession,
  path: string,
): Promise<number | null> {
  const r = await ssh.exec(`df -Pk ${JSON.stringify(path)} 2>/dev/null || df -Pk /tmp`);
  if (r.code !== 0) return null;
  return parseDfAvailableBytes(r.stdout || r.stderr);
}

export function directorySizeBytes(path: string): number {
  if (!existsSync(path)) return 0;
  const st = statSync(path);
  if (!st.isDirectory()) return st.size;
  // Prefer `du` for trees (fast enough for preflight).
  try {
    const out = execFileSync("du", ["-sk", path], {
      encoding: "utf8",
      maxBuffer: 1024 * 64,
    });
    const kb = Number(out.trim().split(/\s+/)[0]);
    return Number.isFinite(kb) ? kb * 1024 : 0;
  } catch {
    return 0;
  }
}

export function assertLocalFreeSpace(
  path: string,
  needBytes: number,
  context: string,
): void {
  const free = getFreeBytes(path);
  if (free == null) return; // don't block if we can't measure
  if (free >= needBytes) return;
  throw new Error(
    `${context}: not enough free disk space on ${path} ` +
      `(need ~${formatBytes(needBytes)}, have ${formatBytes(free)}). ` +
      `Free space and retry.`,
  );
}

export async function assertRemoteFreeSpace(
  ssh: SshSession,
  path: string,
  needBytes: number,
  context: string,
): Promise<void> {
  const free = await getRemoteFreeBytes(ssh, path);
  if (free == null) return;
  if (free >= needBytes) return;
  throw new Error(
    `${context}: not enough free disk space on remote ${path} ` +
      `(need ~${formatBytes(needBytes)}, have ${formatBytes(free)}). ` +
      `Free space on the host and retry.`,
  );
}

/** Heuristic needs — conservative, silent when OK. */
export const DISK_NEED = {
  /** DB dump + headroom */
  dbBackupLocal: 256 * 1024 * 1024,
  dbBackupRemoteTmp: 256 * 1024 * 1024,
  /** Absolute floor for full backups */
  fullBackupFloor: 512 * 1024 * 1024,
} as const;

export function needForFullBackup(wpContentBytes: number): number {
  const estimated = Math.ceil(wpContentBytes * 1.35) + 64 * 1024 * 1024;
  return Math.max(DISK_NEED.fullBackupFloor, estimated);
}

export function isNoSpaceError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /ENOSPC|no space left|disk quota exceeded/i.test(msg);
}

export function wrapNoSpaceError(err: unknown, context: string): Error {
  if (!isNoSpaceError(err)) {
    return err instanceof Error ? err : new Error(String(err));
  }
  const base = err instanceof Error ? err.message : String(err);
  return new Error(
    `${context}: ran out of disk space while writing. ${base} Free space and retry.`,
  );
}

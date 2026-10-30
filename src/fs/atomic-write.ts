import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { fsAuditLog } from "./audit-log.js";
import { logInfo } from "../utils/logger.js";

export type AtomicWriteOptions = {
  configDir?: string;
  projectId?: string;
  mode?: number;
  backup?: boolean;
  /**
   * Write directly to the file instead of rename-replace.
   * Use for Docker file bind mounts where rename changes the inode
   * and the container keeps the old file (nlink=0).
   */
  inPlace?: boolean;
};

function tmpPath(target: string): string {
  const hex = randomBytes(4).toString("hex");
  return `${target}.${process.pid}.${hex}.tmp`;
}

/** Write via temp file + rename on the same filesystem (atomic replace). */
export function writeFileAtomic(target: string, content: string, options: AtomicWriteOptions = {}): void {
  mkdirSync(dirname(target), { recursive: true });

  if (options.backup && existsSync(target)) {
    const bak = `${target}.bak`;
    try {
      copyFileSync(target, bak);
    } catch {
      /* non-fatal */
    }
  }

  if (options.inPlace) {
    const tmp = tmpPath(target);
    const mode = options.mode ?? 0o644;
    writeFileSync(tmp, content, { mode });
    let tmpFd = openSync(tmp, "r");
    try {
      fsyncSync(tmpFd);
    } finally {
      closeSync(tmpFd);
    }
    const flags = existsSync(target) ? "w" : "wx";
    const fd = openSync(target, flags, mode);
    try {
      const buf = Buffer.from(content, "utf8");
      writeSync(fd, buf, 0, buf.length, 0);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    unlinkSync(tmp);
    logInfo(`fs: inPlace write to ${target} (inode preserved)`);
    if (options.configDir && options.projectId) {
      fsAuditLog(options.configDir, options.projectId, "fs.write_inplace", { path: target });
    }
  } else {
    const tmp = tmpPath(target);
    writeFileSync(tmp, content, { mode: options.mode ?? 0o644 });
    renameSync(tmp, target);
    if (options.configDir && options.projectId) {
      fsAuditLog(options.configDir, options.projectId, "fs.write_atomic", { path: target });
    }
  }
}

export function writeJsonAtomic(
  target: string,
  data: unknown,
  options: AtomicWriteOptions = {},
): void {
  const content = `${JSON.stringify(data, null, 2)}\n`;
  writeFileAtomic(target, content, options);
}

/** Remove stale *.tmp files next to managed files (crash recovery). */
export function sweepStaleTmpFiles(dir: string, maxAgeMs = 3_600_000): number {
  if (!existsSync(dir)) return 0;
  let removed = 0;
  const now = Date.now();
  for (const name of readdirSync(dir)) {
    if (!name.includes(".tmp")) continue;
    const full = join(dir, name);
    try {
      const st = statSync(full);
      if (now - st.mtimeMs > maxAgeMs) {
        unlinkSync(full);
        removed += 1;
      }
    } catch {
      /* ignore */
    }
  }
  return removed;
}

export function readTextFile(path: string): string {
  return readFileSync(path, "utf8");
}

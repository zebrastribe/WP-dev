import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { fsAuditLog } from "./audit-log.js";

export type AtomicWriteOptions = {
  configDir?: string;
  projectId?: string;
  mode?: number;
  backup?: boolean;
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

  const tmp = tmpPath(target);
  writeFileSync(tmp, content, { mode: options.mode ?? 0o644 });
  renameSync(tmp, target);

  if (options.configDir && options.projectId) {
    fsAuditLog(options.configDir, options.projectId, "fs.write_atomic", { path: target });
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

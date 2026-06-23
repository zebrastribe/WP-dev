import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { lockPath } from "./paths.js";
import type { ProjectLockData } from "./types.js";

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readLockData(configDir: string): ProjectLockData | null {
  const path = lockPath(configDir);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8").trim();
    const data = JSON.parse(raw) as ProjectLockData;
    if (!data.pid || !data.projectId || !data.configDir) return null;
    return data;
  } catch {
    return null;
  }
}

export function isLockStale(configDir: string): boolean {
  const data = readLockData(configDir);
  if (!data) return false;
  return !isPidAlive(data.pid);
}

export function removeStaleLock(configDir: string): boolean {
  if (!isLockStale(configDir)) return false;
  try {
    unlinkSync(lockPath(configDir));
    return true;
  } catch {
    return false;
  }
}

export class ProjectLock {
  private fd: number | null = null;

  constructor(private readonly configDir: string) {}

  tryAcquire(data: ProjectLockData): boolean {
    removeStaleLock(this.configDir);
    mkdirSync(lockPath(this.configDir).replace(/\/[^/]+$/, ""), { recursive: true });
    try {
      this.fd = openSync(lockPath(this.configDir), "wx");
      writeFileSync(this.fd, `${JSON.stringify(data, null, 2)}\n`, "utf8");
      return true;
    } catch (e) {
      const code = e && typeof e === "object" && "code" in e ? String(e.code) : "";
      if (code === "EEXIST") return false;
      throw e;
    }
  }

  release(): void {
    if (this.fd === null) return;
    try {
      closeSync(this.fd);
    } catch {
      /* ignore */
    }
    this.fd = null;
    try {
      unlinkSync(lockPath(this.configDir));
    } catch {
      /* ignore */
    }
  }
}

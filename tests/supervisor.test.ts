import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectLock, readLockData, removeStaleLock } from "../src/supervisor/project-lock.js";
import { emptyRegistry, loadRegistry, saveRegistry } from "../src/supervisor/service-registry.js";
import { defaultSupervisorPort } from "../src/supervisor/paths.js";

describe("supervisor project-lock", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "wp-dev-lock-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("acquires and releases exclusive lock", () => {
    const lock = new ProjectLock(dir);
    const ok = lock.tryAcquire({
      pid: process.pid,
      projectId: "test",
      configDir: dir,
      supervisorPort: 17680,
      startedAt: new Date().toISOString(),
    });
    expect(ok).toBe(true);
    expect(readLockData(dir)?.pid).toBe(process.pid);

    const lock2 = new ProjectLock(dir);
    expect(lock2.tryAcquire({
      pid: process.pid + 1,
      projectId: "test",
      configDir: dir,
      supervisorPort: 17681,
      startedAt: new Date().toISOString(),
    })).toBe(false);

    lock.release();
    expect(readLockData(dir)).toBeNull();
  });

  it("removeStaleLock clears dead pid locks", () => {
    const lock = new ProjectLock(dir);
    lock.tryAcquire({
      pid: 999999,
      projectId: "test",
      configDir: dir,
      supervisorPort: 17680,
      startedAt: new Date().toISOString(),
    });
    expect(removeStaleLock(dir)).toBe(true);
    expect(readLockData(dir)).toBeNull();
  });
});

describe("supervisor service-registry", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "wp-dev-reg-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("persists and loads registry atomically", () => {
    const reg = emptyRegistry("proj", dir, 1234, defaultSupervisorPort("proj"));
    saveRegistry(dir, reg);
    expect(existsSync(join(dir, "logs", "service-registry.json"))).toBe(true);
    const loaded = loadRegistry(dir);
    expect(loaded?.projectId).toBe("proj");
    expect(loaded?.supervisorPid).toBe(1234);
  });
});

import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectLock, readLockData, removeStaleLock } from "../src/supervisor/project-lock.js";
import { emptyRegistry, loadRegistry, saveRegistry, upsertService } from "../src/supervisor/service-registry.js";
import { createInitialRegistry } from "../src/supervisor/startup.js";
import { defaultSupervisorPort, lockPath } from "../src/supervisor/paths.js";
import type { LoadedConfig } from "../src/config/load.js";

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

  it("removeStaleLock clears corrupt lock files", () => {
    mkdirSync(join(dir, "logs"), { recursive: true });
    writeFileSync(lockPath(dir), "{broken", "utf8");
    expect(removeStaleLock(dir)).toBe(true);
    const lock = new ProjectLock(dir);
    expect(
      lock.tryAcquire({
        pid: process.pid,
        projectId: "test",
        configDir: dir,
        supervisorPort: 17680,
        startedAt: new Date().toISOString(),
      }),
    ).toBe(true);
    lock.release();
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

  it("createInitialRegistry keeps existing services", () => {
    let reg = emptyRegistry("proj", dir, 1, defaultSupervisorPort("proj"));
    const now = new Date().toISOString();
    reg = upsertService(reg, {
      name: "wordpress",
      kind: "docker",
      projectId: "proj",
      status: "running",
      health: "healthy",
      startedAt: now,
      lastHeartbeat: now,
      restartCount: 0,
      cwd: dir,
      logPath: join(dir, "logs", "wordpress.log"),
      bindAddress: "127.0.0.1",
    });
    saveRegistry(dir, reg);
    const loadedCfg = {
      configDir: dir,
      config: {
        project: "proj",
        local: { path: "docker", url: "http://localhost", composeFile: "docker-compose.yml", composeService: "wordpress", wpRoot: "wordpress" },
      },
    } as LoadedConfig;
    const next = createInitialRegistry(loadedCfg, 9999, 17680);
    expect(next.supervisorPid).toBe(9999);
    expect(next.services).toHaveLength(1);
    expect(next.services[0]?.name).toBe("wordpress");
  });

  it("createInitialRegistry seeds compose services when empty", () => {
    const loadedCfg = {
      configDir: dir,
      config: {
        project: "proj",
        local: { path: "docker", url: "http://localhost", composeFile: "docker-compose.yml", composeService: "wordpress", wpRoot: "wordpress" },
      },
    } as LoadedConfig;
    const next = createInitialRegistry(loadedCfg, 42, 17680);
    expect(next.services.map((s) => s.name)).toEqual(
      expect.arrayContaining(["db", "wordpress", "terminal", "terminal-runner", "sync-runner"]),
    );
  });
});

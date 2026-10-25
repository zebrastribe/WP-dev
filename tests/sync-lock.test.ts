import { afterEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import {
  acquireSyncLock,
  isLockPidAlive,
  releaseSyncLock,
  type SyncLockHandle,
} from "../src/utils/sync-lock.js";

describe("acquireSyncLock", () => {
  const held: SyncLockHandle[] = [];

  afterEach(() => {
    while (held.length) {
      releaseSyncLock(held.pop() ?? null);
    }
  });

  it("keys the lock file by project id, not cwd", () => {
    const lock = acquireSyncLock("timework", "pull:staging");
    held.push(lock);
    expect(lock.path).toBe(join(homedir(), ".wp-dev", "locks", "sync-project-timework.lock"));
  });

  it("blocks a second acquire for the same project", () => {
    held.push(acquireSyncLock("shared-project", "push:production"));
    expect(() => acquireSyncLock("shared-project", "restore:local")).toThrow(
      /Another sync is in progress/,
    );
  });

  it("allows concurrent locks for different projects", () => {
    held.push(acquireSyncLock("site-a", "pull:staging"));
    held.push(acquireSyncLock("site-b", "pull:staging"));
    expect(held[0].path).not.toBe(held[1].path);
  });

  it("sanitizes project id in the lock filename", () => {
    const lock = acquireSyncLock("My Site/v2!", "op");
    held.push(lock);
    expect(lock.path).toBe(join(homedir(), ".wp-dev", "locks", "sync-project-My_Site_v2_.lock"));
  });

  it("reports whether a pid is alive", () => {
    expect(isLockPidAlive(process.pid)).toBe(true);
    expect(isLockPidAlive(999_999_999)).toBe(false);
    expect(isLockPidAlive(undefined)).toBe(false);
  });

  it("reclaims a lock when the recorded pid is dead", () => {
    const dir = join(homedir(), ".wp-dev", "locks");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "sync-project-dead-pid-reclaim.lock");
    if (existsSync(path)) unlinkSync(path);
    writeFileSync(
      path,
      JSON.stringify({
        pid: 999_999_999,
        op: "pull:production",
        at: new Date().toISOString(),
      }),
    );
    const lock = acquireSyncLock("dead-pid-reclaim", "pull:staging");
    held.push(lock);
    expect(lock.path).toBe(path);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import { homedir, hostname } from "node:os";
import {
  mkdirSync,
  writeFileSync,
  unlinkSync,
  existsSync,
  closeSync,
  readFileSync,
} from "node:fs";
import {
  acquireSyncLock,
  canReclaimSyncLock,
  isLockPidAlive,
  parseSyncLockPayload,
  releaseSyncLock,
  type SyncLockHandle,
  type SyncLockPayload,
} from "../src/utils/sync-lock.js";

function writeLockFixture(name: string, payload: Partial<SyncLockPayload> & { pid: number; op: string }) {
  const dir = join(homedir(), ".wp-dev", "locks");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `sync-project-${name}.lock`);
  if (existsSync(path)) unlinkSync(path);
  const full: SyncLockPayload = {
    pid: payload.pid,
    op: payload.op,
    at: payload.at ?? new Date().toISOString(),
    token: payload.token ?? "fixture-token",
    host: payload.host ?? hostname(),
  };
  writeFileSync(path, JSON.stringify(full));
  return path;
}

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

  it("reclaims a lock when the recorded pid is dead on the same host", () => {
    const path = writeLockFixture("dead-pid-reclaim", {
      pid: 999_999_999,
      op: "pull:production",
    });
    const lock = acquireSyncLock("dead-pid-reclaim", "pull:staging");
    held.push(lock);
    expect(lock.path).toBe(path);
  });

  it("writes host and token into the lock payload", () => {
    const lock = acquireSyncLock("payload-shape", "push:staging");
    held.push(lock);
    const parsed = parseSyncLockPayload(readFileSync(lock.path, "utf8"));
    expect(parsed?.host).toBe(hostname());
    expect(parsed?.token).toBe(lock.token);
    expect(parsed?.pid).toBe(process.pid);
  });

  it("does not reclaim a live same-host lock just because it is old", () => {
    const path = writeLockFixture("old-but-alive", {
      pid: process.pid,
      op: "pull:staging",
      at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    });
    expect(() => acquireSyncLock("old-but-alive", "push:staging")).toThrow(/Another sync/);
    unlinkSync(path);
  });

  it("does not reclaim a foreign-host lock that is still young (PID check meaningless)", () => {
    const path = writeLockFixture("foreign-young", {
      pid: 999_999_999,
      op: "pull:staging",
      host: "other-hostname-not-this-machine",
      at: new Date().toISOString(),
    });
    expect(() => acquireSyncLock("foreign-young", "push:staging")).toThrow(/Another sync/);
    unlinkSync(path);
  });

  it("reclaims a foreign-host lock after the cross-namespace stale window", () => {
    const path = writeLockFixture("foreign-stale", {
      pid: 999_999_999,
      op: "pull:staging",
      host: "other-hostname-not-this-machine",
      at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    });
    const lock = acquireSyncLock("foreign-stale", "push:staging");
    held.push(lock);
    expect(lock.path).toBe(path);
  });

  it("refuses to steal a corrupt non-empty lock", () => {
    const dir = join(homedir(), ".wp-dev", "locks");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "sync-project-corrupt-lock.lock");
    if (existsSync(path)) unlinkSync(path);
    writeFileSync(path, "{not-json");
    expect(() => acquireSyncLock("corrupt-lock", "op")).toThrow(/corrupt or incomplete/);
    unlinkSync(path);
  });

  it("release does not unlink a lock taken over by another owner token", () => {
    const first = acquireSyncLock("release-token", "op1");
    // Simulate successor: close fd without release, rewrite file as another owner.
    closeSync(first.fd);
    writeFileSync(
      first.path,
      JSON.stringify({
        pid: process.pid,
        op: "op2",
        at: new Date().toISOString(),
        token: "successor-token",
        host: hostname(),
      }),
    );
    releaseSyncLock(first);
    expect(existsSync(first.path)).toBe(true);
    unlinkSync(first.path);
  });
});

describe("canReclaimSyncLock", () => {
  it("same host: dead pid reclaimable, live pid not", () => {
    const host = hostname();
    expect(
      canReclaimSyncLock({
        pid: 999_999_999,
        op: "x",
        at: new Date().toISOString(),
        token: "t",
        host,
      }),
    ).toBe(true);
    expect(
      canReclaimSyncLock({
        pid: process.pid,
        op: "x",
        at: new Date(Date.now() - 9 * 60 * 60 * 1000).toISOString(),
        token: "t",
        host,
      }),
    ).toBe(false);
  });

  it("foreign host: only after stale window", () => {
    const foreign = {
      pid: 1,
      op: "x",
      token: "t",
      host: "not-" + hostname(),
      at: new Date().toISOString(),
    };
    expect(canReclaimSyncLock(foreign)).toBe(false);
    expect(
      canReclaimSyncLock({
        ...foreign,
        at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
      }),
    ).toBe(true);
  });
});

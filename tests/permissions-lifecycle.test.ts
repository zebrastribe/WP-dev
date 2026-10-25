import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildHostSharedWritePermissionsShell,
  buildRuntimeWritePermissionsShell,
  RUNTIME_WRITE_PATHS,
} from "../src/commands/fix-permissions.js";

/**
 * Contract: permissions are a core WP-dev behavior across sync scenarios.
 * Pre-rsync = host-only; post-sync = host:www-data tree + www-data runtime.
 * All local wordpress/ file mutations MUST go through runLocalWordpressFileMutation.
 */
describe("WordPress permissions lifecycle (sync contract)", () => {
  const root = process.cwd();

  it("post-sync shell applies shared tree before runtime www-data (core updates)", () => {
    const shared = buildHostSharedWritePermissionsShell(1000);
    const runtime = buildRuntimeWritePermissionsShell();
    expect(shared.indexOf("chown -R 1000:33")).toBeGreaterThanOrEqual(0);
    expect(runtime).toContain("wp-content/ai1wm-backups");
    for (const p of RUNTIME_WRITE_PATHS) {
      expect(runtime).toContain(p);
    }
    expect(runtime).not.toContain("chown -R 33:33 '/var/www/html/wp-content/themes'");
  });

  it("runLocalWordpressFileMutation is the required envelope (host → work → after)", () => {
    const reconcile = readFileSync(join(root, "src/fs/ownership/reconcile.ts"), "utf8");
    const fnStart = reconcile.indexOf("export async function runLocalWordpressFileMutation");
    expect(fnStart).toBeGreaterThan(-1);
    const slice = reconcile.slice(fnStart, fnStart + 1800);
    const hostIdx = slice.indexOf("reconcileHostWritableForRsync");
    const workIdx = slice.indexOf("await work()");
    const afterIdx = slice.indexOf("reconcileAfterPull");
    expect(hostIdx).toBeGreaterThan(-1);
    expect(workIdx).toBeGreaterThan(hostIdx);
    expect(afterIdx).toBeGreaterThan(workIdx);
  });

  it("pull / pull-theme / local restore use runLocalWordpressFileMutation", () => {
    const pull = readFileSync(join(root, "src/commands/pull.ts"), "utf8");
    const theme = readFileSync(join(root, "src/commands/pull-theme.ts"), "utf8");
    const restore = readFileSync(join(root, "src/commands/restore.ts"), "utf8");
    expect(pull).toContain("runLocalWordpressFileMutation");
    expect(theme).toContain("runLocalWordpressFileMutation");
    expect(restore).toContain("runLocalWordpressFileMutation");
    // No ad-hoc pre/post pair outside the envelope in these commands.
    expect(pull).not.toMatch(/await reconcileHostWritableForRsync/);
    expect(pull).not.toMatch(/await reconcileAfterPull/);
    expect(theme).not.toMatch(/await reconcileHostWritableForRsync/);
    expect(theme).not.toMatch(/await reconcileAfterPull/);
  });

  it("up re-applies runtime permissions; remote restore does not", () => {
    const up = readFileSync(join(root, "src/commands/up.ts"), "utf8");
    const restore = readFileSync(join(root, "src/commands/restore.ts"), "utf8");
    expect(up).toContain("reconcileContainerRuntime");
    const remoteStart = restore.indexOf("async function restoreRemoteArchive");
    const remoteEnd = restore.indexOf("export async function cmdRestore");
    const remoteFn = restore.slice(remoteStart, remoteEnd === -1 ? undefined : remoteEnd);
    expect(remoteFn).toContain("connectSsh");
    expect(remoteFn).not.toContain("runLocalWordpressFileMutation");
    expect(remoteFn).not.toContain("reconcileAfterPull");
    expect(remoteFn).not.toContain("cmdFixPermissions");
  });

  it("cmdFixRuntimeWritePermissions orders shared tree then runtime", () => {
    const src = readFileSync(join(root, "src/commands/fix-permissions.ts"), "utf8");
    const fnStart = src.indexOf("export async function cmdFixRuntimeWritePermissions");
    const slice = src.slice(fnStart, fnStart + 1200);
    expect(slice.indexOf("buildHostSharedWritePermissionsShell")).toBeLessThan(
      slice.indexOf("buildRuntimeWritePermissionsShell"),
    );
  });

  it("permission fixes never run on staging/production (compose wordpress only)", () => {
    const fix = readFileSync(join(root, "src/commands/fix-permissions.ts"), "utf8");
    const push = readFileSync(join(root, "src/commands/push.ts"), "utf8");
    const pushTheme = readFileSync(join(root, "src/commands/push-theme.ts"), "utf8");
    expect(fix).toMatch(/LOCAL DOCKER ONLY|LOCAL only/);
    expect(fix).toContain('"/var/www/html"');
    expect(fix).toContain("composeLocalWordpress");
    expect(fix).not.toMatch(/connectSsh|ssh\.exec/);
    expect(push).not.toMatch(
      /runLocalWordpressFileMutation|reconcileAfterPull|cmdFixPermissions|cmdFixRuntimeWritePermissions|reconcileContainerRuntime/,
    );
    expect(pushTheme).not.toMatch(
      /runLocalWordpressFileMutation|reconcileAfterPull|cmdFixPermissions|cmdFixRuntimeWritePermissions/,
    );
  });
});

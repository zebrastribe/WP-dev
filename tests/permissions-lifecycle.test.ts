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
    // Themes must not be www-data-owned in the runtime pass (IDE edit).
    expect(runtime).not.toContain("chown -R 33:33 '/var/www/html/wp-content/themes'");
  });

  it("pull: host-writable before rsync, reconcileAfterPull after", () => {
    const pull = readFileSync(join(root, "src/commands/pull.ts"), "utf8");
    expect(pull).toContain("reconcileHostWritableForRsync");
    expect(pull).toContain("reconcileAfterPull");
    expect(pull).not.toMatch(/await cmdFixPermissions/);
    // Must not leave only runtime www-data without the shared-tree pass after pull.
    const afterIdx = pull.indexOf("reconcileAfterPull");
    expect(afterIdx).toBeGreaterThan(pull.indexOf("rsyncPull"));
  });

  it("pull-theme uses the same pre/post rsync permission contract", () => {
    const theme = readFileSync(join(root, "src/commands/pull-theme.ts"), "utf8");
    expect(theme).toContain("reconcileHostWritableForRsync");
    expect(theme).toContain("reconcileAfterPull");
  });

  it("up and restore re-apply Apache-writable permissions", () => {
    const up = readFileSync(join(root, "src/commands/up.ts"), "utf8");
    const restore = readFileSync(join(root, "src/commands/restore.ts"), "utf8");
    const reconcile = readFileSync(join(root, "src/fs/ownership/reconcile.ts"), "utf8");
    expect(up).toContain("reconcileContainerRuntime");
    expect(restore).toContain("reconcileAfterPull");
    expect(reconcile).toMatch(
      /export async function reconcileAfterPull[\s\S]*?reconcileContainerRuntime[\s\S]*?reconcileSharedConfig/,
    );
    expect(reconcile).toMatch(
      /export async function reconcileHostWritableForRsync[\s\S]*?reconcileHostEditable/,
    );
  });

  it("cmdFixRuntimeWritePermissions orders shared tree then runtime", () => {
    const src = readFileSync(join(root, "src/commands/fix-permissions.ts"), "utf8");
    const sharedIdx = src.indexOf("buildHostSharedWritePermissionsShell(uid)");
    const runtimeIdx = src.indexOf("buildRuntimeWritePermissionsShell()");
    // In cmdFixRuntimeWritePermissions body, shared must come first in the joined shell.
    const fnStart = src.indexOf("export async function cmdFixRuntimeWritePermissions");
    const slice = src.slice(fnStart, fnStart + 1200);
    expect(slice.indexOf("buildHostSharedWritePermissionsShell")).toBeLessThan(
      slice.indexOf("buildRuntimeWritePermissionsShell"),
    );
    expect(sharedIdx).toBeGreaterThan(-1);
    expect(runtimeIdx).toBeGreaterThan(-1);
  });
});

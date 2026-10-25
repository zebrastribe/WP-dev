import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RUNTIME_WRITE_PATHS,
  WWW_DATA_GID,
  WWW_DATA_UID,
  buildRuntimeWritePermissionsShell,
} from "../src/commands/fix-permissions.js";
import { buildSharedConfigReconcileShell } from "../src/fs/ownership/reconcile.js";

describe("fix-permissions runtime paths", () => {
  it("cmdFixPermissions uses resolveHostIdentity (not raw userInfo) for container pulls", () => {
    const src = readFileSync(join(process.cwd(), "src/commands/fix-permissions.ts"), "utf8");
    expect(src).toContain("resolveHostIdentity");
    expect(src).not.toMatch(/from "node:os".*userInfo|userInfo\(\)/s);
  });

  it("lists runtime write paths without themes", () => {
    expect(RUNTIME_WRITE_PATHS).toContain("wp-content/upgrade");
    expect(RUNTIME_WRITE_PATHS).toContain("wp-content/upgrade-temp-backup");
    expect(RUNTIME_WRITE_PATHS).toContain("wp-content/plugins");
    expect(RUNTIME_WRITE_PATHS).not.toContain("wp-content/themes");
  });

  it("buildRuntimeWritePermissionsShell chowns only runtime paths as www-data", () => {
    const sh = buildRuntimeWritePermissionsShell();
    for (const rel of RUNTIME_WRITE_PATHS) {
      expect(sh).toContain(`/var/www/html/${rel}`);
      expect(sh).toContain(
        `chown -R ${WWW_DATA_UID}:${WWW_DATA_GID} '/var/www/html/${rel}'`,
      );
    }
    expect(sh).toContain("mkdir -p '/var/www/html/wp-content/themes'");
    expect(sh).not.toContain(
      `chown -R ${WWW_DATA_UID}:${WWW_DATA_GID} '/var/www/html/wp-content/themes'`,
    );
    expect(sh).toContain("chmod 775");
    expect(sh).toContain("chmod 664");
  });

  it("supports a custom html root", () => {
    const sh = buildRuntimeWritePermissionsShell("/srv/wp");
    expect(sh).toContain("/srv/wp/wp-content/upgrade");
    expect(sh).not.toContain("/var/www/html/wp-content/upgrade");
  });
});

describe("shared config reconcile", () => {
  it("keeps docker/.env group-writable for www-data and not world-readable", () => {
    const sh = buildSharedConfigReconcileShell(1000, 1000, 33);
    expect(sh).toContain("chown 1000:33 /wp-dev-repo/docker/.env");
    expect(sh).toContain(".env.bak");
    expect(sh).toContain("chmod 660 /wp-dev-repo/docker/.env");
    expect(sh).toContain("chmod 664 /wp-dev-repo/wp-dev.config.json");
    expect(sh).not.toMatch(/chmod 664 \/wp-dev-repo\/docker\/\.env/);
  });

  it("makes logs/ writable by www-data for admin API log", () => {
    const sh = buildSharedConfigReconcileShell(1000, 1000, 33);
    expect(sh).toContain("chown 1000:33 /wp-dev-repo/logs");
    expect(sh).toContain("chmod 2775 /wp-dev-repo/logs");
    expect(sh).toContain("wp-dev-admin-api.log");
  });
});

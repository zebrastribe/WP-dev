import { describe, expect, it } from "vitest";
import {
  RUNTIME_WRITE_PATHS,
  WWW_DATA_GID,
  WWW_DATA_UID,
  buildRuntimeWritePermissionsShell,
} from "../src/commands/fix-permissions.js";

describe("fix-permissions runtime paths", () => {
  it("lists runtime write paths without themes", () => {
    expect(RUNTIME_WRITE_PATHS).toContain("wp-content/upgrade");
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

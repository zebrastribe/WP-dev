import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  WPDEV_ADMIN_API_MARKER,
  buildRemoteWpDevAdminProbeCommand,
  remoteLooksLikeWpDevAdmin,
  remoteWpDevAdminDir,
} from "../src/utils/remote-admin-purge.js";

describe("remote-admin-purge", () => {
  it("builds admin dir under the WP root", () => {
    expect(remoteWpDevAdminDir("/var/www/html/")).toBe("/var/www/html/admin");
  });

  it("probe requires api.php marker and quotes paths", () => {
    const cmd = buildRemoteWpDevAdminProbeCommand("/var/www/html/admin");
    expect(cmd).toContain("api.php");
    expect(cmd).toContain("WPDEV_ADMIN_UI");
    expect(cmd).toContain("grep -Fq");
    expect(cmd).toContain(WPDEV_ADMIN_API_MARKER);
    expect(cmd).toContain("'/var/www/html/admin'");
  });

  it("recognizes probe stdout only when marker token present", () => {
    expect(remoteLooksLikeWpDevAdmin("WPDEV_ADMIN_UI\n")).toBe(true);
    expect(remoteLooksLikeWpDevAdmin("")).toBe(false);
    expect(remoteLooksLikeWpDevAdmin("admin exists")).toBe(false);
  });

  it("local api.php still contains the marker used for remote probes", () => {
    const api = readFileSync(join("docs/admin/public/api.php"), "utf8");
    expect(api).toContain(WPDEV_ADMIN_API_MARKER);
  });
});

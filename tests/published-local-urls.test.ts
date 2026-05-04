import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import type { LoadedConfig } from "../src/config/load.js";
import {
  dockerComposeEnvPath,
  getPublishedLocalAccess,
  readWpPortFromDockerEnvFile,
} from "../src/utils/published-local-urls.js";

function loadedFixture(dir: string, localUrl: string): LoadedConfig {
  return {
    configDir: dir,
    config: {
      project: "t",
      local: {
        url: localUrl,
        path: ".",
        composeFile: "docker-compose.yml",
        composeService: "wpcli",
        wpRoot: "./wordpress",
      },
      staging: {
        host: "s.invalid",
        user: "u",
        path: "/p",
        url: "https://s.invalid",
      },
      production: {
        host: "p.invalid",
        user: "u",
        path: "/p",
        url: "https://p.invalid",
      },
    },
  };
}

describe("published-local-urls", () => {
  it("reads WP_PORT from docker/.env", () => {
    const dir = mkdtempSync(join(tmpdir(), "wpdev-plu-"));
    const env = join(dir, ".env");
    writeFileSync(env, "FOO=1\nWP_PORT=8890\n", "utf8");
    expect(readWpPortFromDockerEnvFile(env)).toBe(8890);
  });

  it("prefers docker WP_PORT over stale localhost port in local.url", () => {
    const dir = mkdtempSync(join(tmpdir(), "wpdev-plu-"));
    writeFileSync(join(dir, ".env"), "WP_PORT=8890\n", "utf8");
    const loaded = loadedFixture(dir, "http://localhost:8888/");
    const { site, admin, warnings } = getPublishedLocalAccess(loaded);
    expect(site).toBe("http://localhost:8890");
    expect(admin).toContain("8890");
    expect(admin).toContain("/admin/");
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("dockerComposeEnvPath joins configDir and local.path", () => {
    const dir = mkdtempSync(join(tmpdir(), "wpdev-plu-"));
    const loaded = loadedFixture(dir, "http://localhost:8888");
    expect(dockerComposeEnvPath(loaded)).toBe(join(dir, ".", ".env"));
  });
});

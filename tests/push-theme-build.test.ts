import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { minimalWpDevConfig } from "./helpers/fixtures.js";
import type { LoadedConfig } from "../src/config/load.js";

const themeBuildMock = vi.fn();
const rsyncPushToPathMock = vi.fn();
const connectSshMock = vi.fn();
const resolveRemoteWpPathMock = vi.fn();

vi.mock("../src/commands/theme-build.js", () => ({
  cmdThemeBuild: (...args: unknown[]) => themeBuildMock(...args),
}));

vi.mock("../src/services/rsync.js", () => ({
  rsyncPushToPath: (...args: unknown[]) => rsyncPushToPathMock(...args),
}));

vi.mock("../src/services/ssh.js", () => ({
  connectSsh: (...args: unknown[]) => connectSshMock(...args),
}));

vi.mock("../src/services/wpcli.js", () => ({
  resolveRemoteWpPath: (...args: unknown[]) => resolveRemoteWpPathMock(...args),
}));

function makeLoaded(configDir: string): LoadedConfig {
  const themeDir = join(configDir, "wordpress/wp-content/themes/agency-starter");
  mkdirSync(join(themeDir, "dist"), { recursive: true });
  writeFileSync(join(themeDir, "style.css"), "/* theme */");
  writeFileSync(join(themeDir, "package.json"), "{}");
  return {
    configDir,
    config: minimalWpDevConfig({
      local: {
        url: "http://localhost:8888",
        path: "./docker",
        composeFile: "docker-compose.yml",
        composeService: "wpcli",
        wpRoot: "./wordpress",
        themePath: themeDir,
        themeSlug: "agency-starter",
      },
    }),
  };
}

describe("cmdPushTheme build-before-dry-run", () => {
  let loaded: LoadedConfig;

  beforeEach(() => {
    themeBuildMock.mockReset().mockResolvedValue(undefined);
    rsyncPushToPathMock.mockReset().mockResolvedValue(undefined);
    resolveRemoteWpPathMock.mockReset().mockResolvedValue({
      installed: true,
      path: "/var/www/staging",
    });
    connectSshMock.mockReset().mockResolvedValue({
      exec: vi.fn().mockResolvedValue({
        code: 0,
        stdout: "WPDEV_PATH_SAFETY has_wp=1 child_wp=0 markers=",
        stderr: "",
      }),
      dispose: vi.fn(),
    });
    loaded = makeLoaded(mkdtempSync(join(tmpdir(), "wp-dev-theme-")));
  });

  it("runs theme build when Preview uses --build even on dry-run", async () => {
    const { cmdPushTheme } = await import("../src/commands/push-theme.js");
    await cmdPushTheme(loaded, "staging", {
      dryRun: true,
      build: true,
      skipBuildCheck: false,
      yes: true,
    });
    expect(themeBuildMock).toHaveBeenCalledTimes(1);
    expect(rsyncPushToPathMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ dryRun: true }),
    );
  });

  it("skips theme build on dry-run when build flag is off", async () => {
    const { cmdPushTheme } = await import("../src/commands/push-theme.js");
    await cmdPushTheme(loaded, "staging", {
      dryRun: true,
      build: false,
      skipBuildCheck: false,
      yes: true,
    });
    expect(themeBuildMock).not.toHaveBeenCalled();
    expect(rsyncPushToPathMock).toHaveBeenCalled();
  });
});

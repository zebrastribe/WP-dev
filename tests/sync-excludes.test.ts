import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  buildPushExcludeRules,
  KNOWN_DEV_PLUGINS,
  pushExcludePatterns,
  RECOMMENDED_PUSH_EXCLUDES,
  SAFE_SYNC_EXCLUDES,
} from "../src/services/sync-excludes.js";
import { parseRsyncItemizeOutput } from "../src/services/sync-preview-parse.js";
import {
  getRecommendedThemeExcludes,
  getThemeUnitConfig,
  themeExcludePatterns,
} from "../src/services/sync-units.js";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("sync-excludes", () => {
  const configDir = "/tmp/wp-dev-test";
  const baseConfig = {
    project: "test",
    local: {
      url: "http://localhost:8888",
      path: "./docker",
      wpRoot: "./wordpress",
    },
    staging: {
      host: "staging.example.com",
      user: "u",
      path: "/staging",
      url: "https://staging.example.com",
    },
    production: {
      host: "example.com",
      user: "u",
      path: "/live",
      url: "https://example.com",
    },
  };

  it("includes safe defaults in push excludes", () => {
    const patterns = pushExcludePatterns(configDir, baseConfig);
    for (const safe of SAFE_SYNC_EXCLUDES) {
      expect(patterns).toContain(safe);
    }
    expect(patterns).toContain("admin");
  });

  it("adds local-only plugin via sync.plugins", () => {
    const patterns = pushExcludePatterns(configDir, {
      ...baseConfig,
      sync: { plugins: { "query-monitor": "localOnly" } },
    });
    expect(patterns).toContain("wp-content/plugins/query-monitor");
  });

  it("respects disabled recommended toggles", () => {
    const withAll = pushExcludePatterns(configDir, baseConfig);
    const withoutDebug = pushExcludePatterns(configDir, {
      ...baseConfig,
      sync: { disabledRecommended: ["debug-log"] },
    });
    expect(withAll).toContain("wp-content/debug.log");
    expect(withoutDebug).not.toContain("wp-content/debug.log");
  });

  it("lists known dev plugins", () => {
    expect(KNOWN_DEV_PLUGINS["query-monitor"]).toBeDefined();
    expect(Object.keys(RECOMMENDED_PUSH_EXCLUDES).length).toBeGreaterThan(0);
  });

  it("buildPushExcludeRules marks categories", () => {
    const rules = buildPushExcludeRules(configDir, baseConfig);
    expect(rules.some((r) => r.category === "safe")).toBe(true);
    expect(rules.some((r) => r.category === "recommended")).toBe(true);
  });
});

describe("sync-units theme deployment", () => {
  let wpRoot: string;

  beforeEach(() => {
    wpRoot = mkdtempSync(join(tmpdir(), "wp-dev-theme-unit-"));
    const theme = join(wpRoot, "wp-content/themes/my-theme");
    mkdirSync(join(theme, "src"), { recursive: true });
    mkdirSync(join(theme, "dist"), { recursive: true });
    mkdirSync(join(theme, "node_modules"), { recursive: true });
    writeFileSync(join(theme, "style.css"), "/* theme */");
    writeFileSync(join(theme, "functions.php"), "<?php");
    writeFileSync(join(theme, "package.json"), "{}");
    writeFileSync(join(theme, "vite.config.js"), "export default {}");
  });

  afterEach(() => {
    rmSync(wpRoot, { recursive: true, force: true });
  });

  it("recommends excluding src and node_modules for build themes", () => {
    const rec = getRecommendedThemeExcludes(wpRoot, "my-theme");
    expect(rec.excludeFolders).toContain("src");
    expect(rec.excludeFolders).toContain("node_modules");
  });

  it("compiles custom theme excludes to rsync patterns", () => {
    const patterns = themeExcludePatterns("my-theme", {
      mode: "custom",
      excludeFolders: ["src", "node_modules"],
      excludeFiles: ["package.json"],
    });
    expect(patterns).toContain("wp-content/themes/my-theme/src");
    expect(patterns).toContain("wp-content/themes/my-theme/node_modules");
    expect(patterns).toContain("wp-content/themes/my-theme/package.json");
  });

  it("buildPushExcludeRules includes theme rules when wpRoot provided", () => {
    const config = {
      project: "t",
      local: { url: "http://localhost:1", path: "./d", wpRoot: "./w" },
      staging: { host: "h", user: "u", path: "/s", url: "https://s.example.com" },
      production: { host: "h", user: "u", path: "/p", url: "https://example.com" },
      sync: {
        themes: {
          "my-theme": {
            mode: "custom" as const,
            excludeFolders: ["src"],
            excludeFiles: [],
          },
        },
      },
    };
    const rules = buildPushExcludeRules("/tmp", config, wpRoot);
    expect(rules.some((r) => r.pattern === "wp-content/themes/my-theme/src")).toBe(true);
    const unit = getThemeUnitConfig(config, "my-theme");
    expect(unit.mode).toBe("custom");
  });
});

describe("sync-preview-parse", () => {
  it("parses push itemize lines", () => {
    const out = [
      "sending incremental file list",
      ">f+++++++++ wp-content/themes/foo/style.css",
      ">f.st...... wp-content/plugins/bar/bar.php",
      "*deleting   wp-content/old.txt",
    ].join("\n");
    const parsed = parseRsyncItemizeOutput(out, "push");
    expect(parsed.added).toContain("wp-content/themes/foo/style.css");
    expect(parsed.updated).toContain("wp-content/plugins/bar/bar.php");
    expect(parsed.deleted).toContain("wp-content/old.txt");
  });

  it("parses pull itemize lines", () => {
    const out = "<f+++++++++ wp-content/uploads/a.jpg\n";
    const parsed = parseRsyncItemizeOutput(out, "pull");
    expect(parsed.added).toContain("wp-content/uploads/a.jpg");
  });
});

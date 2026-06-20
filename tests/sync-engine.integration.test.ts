import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  applySyncRecommendations,
  themeDeployRowsForScan,
  type SyncScanResult,
} from "../src/services/sync-scan.js";
import {
  buildStaysLocalSummary,
  getPluginSyncMode,
  getThemeUnitConfig,
  validateThemeUnit,
} from "../src/services/sync-units.js";
import { collectSyncSafetyWarnings, pushExcludePatterns } from "../src/services/sync-excludes.js";
import { createWordPressFixture, minimalWpDevConfig } from "./helpers/fixtures.js";

describe("sync-scan helpers", () => {
  it("applySyncRecommendations sets plugins and themes without overwriting custom", () => {
    const config = minimalWpDevConfig({
      sync: {
        themes: {
          "agency-starter": { mode: "custom", excludeFolders: ["vendor"] },
        },
      },
    });
    const scan: SyncScanResult = {
      activeTheme: "agency-starter",
      plugins: [],
      themes: [],
      suggestions: {
        devPlugins: ["query-monitor"],
        buildThemes: [
          {
            slug: "agency-starter",
            excludeFolders: ["src"],
            excludeFiles: ["package.json"],
          },
          { slug: "twentytwentyfive", excludeFolders: ["node_modules"], excludeFiles: [] },
        ],
      },
    };
    const next = applySyncRecommendations(config, scan);
    expect(next.sync?.plugins?.["query-monitor"]).toBe("localOnly");
    expect(next.sync?.themes?.["agency-starter"]?.excludeFolders).toContain("vendor");
    expect(next.sync?.themes?.["twentytwentyfive"]?.mode).toBe("custom");
    expect(next.sync?.recommendationsDismissed).toBe(true);
  });
});

describe("sync deployment contract", () => {
  let configDir: string;
  let wpRoot: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "wp-dev-contract-"));
    const fixture = createWordPressFixture(configDir);
    wpRoot = fixture.wpRoot;
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  it("buildStaysLocalSummary lists plugins themes and uploads skip", () => {
    const config = minimalWpDevConfig({
      sync: {
        plugins: { "query-monitor": "localOnly" },
        themes: {
          "agency-starter": {
            mode: "custom",
            excludeFolders: ["src"],
            excludeFiles: [],
          },
        },
        skipUploadsOnPush: true,
      },
    });
    const items = buildStaysLocalSummary(config, wpRoot);
    const paths = items.map((i) => i.path);
    expect(paths).toContain("wp-content/plugins/query-monitor/");
    expect(paths.some((p) => p.includes("agency-starter/src"))).toBe(true);
    expect(paths).toContain("wp-content/uploads/");
  });

  it("collectSyncSafetyWarnings flags excluded style.css", () => {
    const config = minimalWpDevConfig({
      sync: {
        themes: {
          "agency-starter": {
            mode: "custom",
            excludeFolders: [],
            excludeFiles: ["style.css"],
          },
        },
      },
    });
    const warnings = collectSyncSafetyWarnings(config, wpRoot);
    expect(warnings.some((w) => w.includes("style.css"))).toBe(true);
  });

  it("themeDeployRowsForScan reflects custom excludes", () => {
    const unit = getThemeUnitConfig(
      minimalWpDevConfig({
        sync: {
          themes: {
            "agency-starter": {
              mode: "custom",
              excludeFolders: ["src"],
              excludeFiles: ["package.json"],
            },
          },
        },
      }),
      "agency-starter",
    );
    const rows = themeDeployRowsForScan(wpRoot, "agency-starter", unit);
    const src = rows.find((r) => r.name === "src" && r.type === "folder");
    const dist = rows.find((r) => r.name === "dist" && r.type === "folder");
    expect(src?.synced).toBe(false);
    expect(dist?.synced).toBe(true);
  });

  it("getPluginSyncMode prefers sync.plugins over legacy list", () => {
    const config = minimalWpDevConfig({
      sync: {
        plugins: { woocommerce: "sync" },
        localOnlyPlugins: ["woocommerce"],
      },
    });
    expect(getPluginSyncMode(config, "woocommerce")).toBe("sync");
  });

  it("validateThemeUnit passes for safe custom config", () => {
    const unit = getThemeUnitConfig(
      minimalWpDevConfig({
        sync: {
          themes: {
            "agency-starter": {
              mode: "custom",
              excludeFolders: ["src"],
              excludeFiles: ["package.json"],
            },
          },
        },
      }),
      "agency-starter",
    );
    expect(validateThemeUnit(wpRoot, "agency-starter", unit)).toHaveLength(0);
  });
});

describe("sync-units performance", () => {
  it("pushExcludePatterns completes quickly for many plugins", () => {
    const configDir = mkdtempSync(join(tmpdir(), "wp-dev-perf-"));
    try {
      const fixture = createWordPressFixture(configDir);
      for (let i = 0; i < 50; i++) {
        const slug = `plugin-${i}`;
        const dir = join(fixture.wpRoot, "wp-content/plugins", slug);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "index.php"), "");
      }
      const config = minimalWpDevConfig({
        sync: {
          plugins: Object.fromEntries(
            Array.from({ length: 50 }, (_, i) => [`plugin-${i}`, "localOnly" as const]),
          ),
        },
      });
      const t0 = performance.now();
      const patterns = pushExcludePatterns(fixture.configDir, config, fixture.wpRoot);
      const elapsed = performance.now() - t0;
      expect(patterns.length).toBeGreaterThan(50);
      expect(elapsed).toBeLessThan(500);
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildPullExcludeRules,
  buildPushExcludeRules,
  detectSuggestedLocalOnlyPlugins,
  normalizeSyncConfig,
  pullExcludePatterns,
  pushExcludePatterns,
} from "../src/services/sync-excludes.js";
import { createWordPressFixture, minimalWpDevConfig } from "./helpers/fixtures.js";

describe("sync-excludes file and normalization", () => {
  let configDir: string;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "wp-dev-excludes-"));
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  it("reads patterns from .wp-dev/sync-excludes", () => {
    mkdirSync(join(configDir, ".wp-dev"), { recursive: true });
    writeFileSync(join(configDir, ".wp-dev/sync-excludes"), "vendor/**\n# comment\n*.log\n");
    const config = minimalWpDevConfig();
    const rules = buildPushExcludeRules(configDir, config);
    expect(rules.some((r) => r.pattern === "vendor/**")).toBe(true);
    expect(rules.some((r) => r.pattern === "*.log")).toBe(true);
    expect(rules.filter((r) => r.category === "file")).toHaveLength(2);
  });

  it("normalizeSyncConfig migrates localOnlyPlugins to plugins map", () => {
    const config = minimalWpDevConfig({
      sync: { localOnlyPlugins: ["query-monitor", "debug-bar"] },
    });
    const next = normalizeSyncConfig(config);
    expect(next.sync?.plugins?.["query-monitor"]).toBe("localOnly");
    expect(next.sync?.plugins?.["debug-bar"]).toBe("localOnly");
  });

  it("skipUploadsOnPush adds uploads exclude on push only", () => {
    const fixture = createWordPressFixture(configDir);
    const config = minimalWpDevConfig({
      local: { ...minimalWpDevConfig().local, wpRoot: "./wordpress" },
      sync: { skipUploadsOnPush: true },
    });
    const push = pushExcludePatterns(fixture.configDir, config, fixture.wpRoot);
    const pull = buildPullExcludeRules(fixture.configDir, config);
    expect(push).toContain("wp-content/uploads");
    expect(pull.some((r) => r.pattern === "wp-content/uploads")).toBe(false);
  });

  it("pullExcludePatterns deduplicates rule patterns", () => {
    const config = minimalWpDevConfig();
    const patterns = pullExcludePatterns(configDir, config);
    expect(new Set(patterns).size).toBe(patterns.length);
    expect(patterns.length).toBeGreaterThan(0);
  });

  it("detectSuggestedLocalOnlyPlugins finds installed dev tools not marked localOnly", () => {
    const fixture = createWordPressFixture(configDir);
    const qmDir = join(fixture.wpRoot, "wp-content/plugins/query-monitor");
    mkdirSync(qmDir, { recursive: true });
    writeFileSync(join(qmDir, "query-monitor.php"), "");
    const config = minimalWpDevConfig({ sync: { plugins: { "query-monitor": "sync" } } });
    expect(detectSuggestedLocalOnlyPlugins(fixture.wpRoot, config)).toContain("query-monitor");
  });
});

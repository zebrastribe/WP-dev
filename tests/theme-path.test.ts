import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import type { LoadedConfig } from "../src/config/load.js";
import {
  checkThemeBuildArtifacts,
  remoteThemePath,
  resolveThemeDeployDir,
  resolveThemePaths,
  resolveThemeSlug,
} from "../src/services/theme-path.js";

function makeLoaded(
  configDir: string,
  themePath?: string,
  themeSlug?: string,
): LoadedConfig {
  return {
    configDir,
    config: {
      project: "test",
      local: {
        url: "http://localhost:8888",
        path: "./docker",
        wpRoot: "./wordpress",
        composeFile: "docker-compose.yml",
        composeService: "wpcli",
        ...(themePath ? { themePath } : {}),
        ...(themeSlug ? { themeSlug } : {}),
      },
      staging: {
        host: "s.test",
        user: "deploy",
        path: "/var/www/html",
        url: "https://s.test",
      },
      production: {
        host: "p.test",
        user: "deploy",
        path: "/var/www/html",
        url: "https://p.test",
      },
    },
  };
}

describe("theme-path", () => {
  it("resolves _tw nested theme/ deploy dir", () => {
    const root = mkdtempSync(join(tmpdir(), "wpdev-theme-"));
    const source = join(root, "agency-starter");
    mkdirSync(join(source, "theme"), { recursive: true });
    writeFileSync(
      join(source, "theme", "style.css"),
      "/*\nTheme Name: Agency Starter\nText Domain: agency-starter\n*/\n",
      "utf8",
    );
    writeFileSync(join(source, "theme", "functions.php"), "<?php\n", "utf8");

    expect(resolveThemeDeployDir(source)).toBe(join(source, "theme"));
    const loaded = makeLoaded(root, join(source));
    const paths = resolveThemePaths(loaded);
    expect(paths.deployDir).toBe(join(source, "theme"));
    expect(paths.slug).toBe("agency-starter");
  });

  it("resolves flat theme deploy dir", () => {
    const root = mkdtempSync(join(tmpdir(), "wpdev-flat-"));
    const source = join(root, "my-theme");
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "style.css"), "/* Theme Name: My Theme */\n", "utf8");
    writeFileSync(join(source, "functions.php"), "<?php\n", "utf8");

    expect(resolveThemeDeployDir(source)).toBe(source);
  });

  it("uses configured themeSlug override", () => {
    const root = mkdtempSync(join(tmpdir(), "wpdev-slug-"));
    const source = join(root, "src");
    mkdirSync(join(source, "theme"), { recursive: true });
    writeFileSync(join(source, "theme", "style.css"), "/* Text Domain: other */\n", "utf8");
    const loaded = makeLoaded(root, source, "custom-slug");
    expect(resolveThemeSlug(loaded, source, join(source, "theme"))).toBe("custom-slug");
  });

  it("remoteThemePath joins wp root and slug", () => {
    expect(remoteThemePath("/var/www/html", "agency-starter")).toBe(
      "/var/www/html/wp-content/themes/agency-starter",
    );
  });

  it("checkThemeBuildArtifacts flags large style.css", () => {
    const root = mkdtempSync(join(tmpdir(), "wpdev-check-"));
    const deploy = join(root, "theme");
    mkdirSync(deploy, { recursive: true });
    writeFileSync(join(deploy, "functions.php"), "<?php\n", "utf8");
    writeFileSync(join(deploy, "style.css"), "x".repeat(130_000), "utf8");

    const check = checkThemeBuildArtifacts(deploy);
    expect(check.ok).toBe(false);
    expect(check.issues.some((i) => i.includes("bytes"))).toBe(true);
  });
});

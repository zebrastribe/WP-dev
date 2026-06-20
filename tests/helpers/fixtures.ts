import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WpDevConfig } from "../../src/config/schema.js";

export function minimalWpDevConfig(overrides: Partial<WpDevConfig> = {}): WpDevConfig {
  return {
    project: "test-site",
    local: {
      url: "http://localhost:8888",
      path: "./docker",
      composeFile: "docker-compose.yml",
      composeService: "wpcli",
      wpRoot: "./wordpress",
    },
    staging: {
      host: "staging.example.com",
      user: "deploy",
      path: "/var/www/staging",
      url: "https://staging.example.com",
    },
    production: {
      host: "example.com",
      user: "deploy",
      path: "/var/www/live",
      url: "https://example.com",
    },
    ...overrides,
  };
}

export type WordPressFixture = {
  wpRoot: string;
  configDir: string;
  plugins: string[];
  themes: string[];
};

/** Creates a minimal bind-mount-style WordPress tree under configDir/wordpress. */
export function createWordPressFixture(configDir: string): WordPressFixture {
  const wpRoot = join(configDir, "wordpress");
  const plugins = ["akismet", "query-monitor", "woocommerce"];
  const themes = ["twentytwentyfive", "agency-starter"];

  for (const slug of plugins) {
    const dir = join(wpRoot, "wp-content/plugins", slug);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${slug}.php`), "<?php");
  }

  for (const slug of themes) {
    const dir = join(wpRoot, "wp-content/themes", slug);
    mkdirSync(join(dir, "src"), { recursive: true });
    mkdirSync(join(dir, "dist"), { recursive: true });
    mkdirSync(join(dir, "node_modules"), { recursive: true });
    writeFileSync(join(dir, "style.css"), "/* theme */");
    writeFileSync(join(dir, "functions.php"), "<?php");
    if (slug === "agency-starter") {
      writeFileSync(join(dir, "package.json"), "{}");
      writeFileSync(join(dir, "vite.config.js"), "export default {}");
    }
  }

  writeFileSync(join(wpRoot, "wp-config.php"), "<?php");
  mkdirSync(join(configDir, ".wp-dev"), { recursive: true });

  return { wpRoot, configDir, plugins, themes };
}

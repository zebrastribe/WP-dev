import { describe, expect, it } from "vitest";
import { dockerComposeProjectId } from "../src/services/docker-compose.js";
import type { WpflowConfig } from "../src/config/schema.js";

function cfg(overrides: Partial<WpflowConfig>): WpflowConfig {
  const base: WpflowConfig = {
    project: "my-site",
    local: {
      url: "http://localhost:8888",
      path: "./docker",
      composeFile: "docker-compose.yml",
      composeService: "wpcli",
      wpRoot: "./wordpress",
    },
    staging: {
      host: "s.example.com",
      user: "u",
      path: "/var/www/s",
      url: "https://s.example.com",
    },
    production: {
      host: "p.example.com",
      user: "u",
      path: "/var/www/p",
      url: "https://p.example.com",
    },
  };
  return {
    ...base,
    ...overrides,
    local: { ...base.local, ...(overrides.local ?? {}) },
    staging: { ...base.staging, ...(overrides.staging ?? {}) },
    production: { ...base.production, ...(overrides.production ?? {}) },
  };
}

describe("dockerComposeProjectId", () => {
  it("sanitizes project name", () => {
    expect(dockerComposeProjectId(cfg({ project: "My Shop!!!" }))).toBe("my-shop");
  });

  it("uses composeProjectName when set", () => {
    expect(
      dockerComposeProjectId(
        cfg({
          local: {
            url: "http://localhost:8888",
            path: "./docker",
            composeFile: "docker-compose.yml",
            composeProjectName: "custom_id",
            composeService: "wpcli",
            wpRoot: "./wordpress",
          },
        }),
      ),
    ).toBe("custom_id");
  });

  it("falls back when project sanitizes to empty", () => {
    expect(dockerComposeProjectId(cfg({ project: "!!!" }))).toBe("wpflow-site");
  });
});

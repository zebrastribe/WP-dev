import { describe, expect, it } from "vitest";
import { wpDevConfigSchema } from "../src/config/schema.js";

describe("sync config schema", () => {
  const base = {
    project: "x",
    local: {
      url: "http://localhost:8888",
      path: "./docker",
      wpRoot: "./wordpress",
    },
    staging: {
      host: "s",
      user: "u",
      path: "/p",
      url: "https://s.example.com",
    },
    production: {
      host: "p",
      user: "u",
      path: "/p",
      url: "https://p.example.com",
    },
  };

  it("accepts sync.plugins and sync.themes", () => {
    const parsed = wpDevConfigSchema.parse({
      ...base,
      sync: {
        plugins: { "query-monitor": "localOnly", woocommerce: "sync" },
        themes: {
          "agency-starter": {
            mode: "custom",
            excludeFolders: ["src", "node_modules"],
            excludeFiles: ["package.json"],
          },
        },
        skipUploadsOnPush: true,
        recommendationsDismissed: false,
      },
    });
    expect(parsed.sync?.plugins?.["query-monitor"]).toBe("localOnly");
    expect(parsed.sync?.themes?.["agency-starter"]?.mode).toBe("custom");
  });

  it("rejects invalid plugin sync mode", () => {
    expect(() =>
      wpDevConfigSchema.parse({
        ...base,
        sync: { plugins: { bad: "sometimes" } },
      }),
    ).toThrow();
  });

  it("rejects invalid theme mode", () => {
    expect(() =>
      wpDevConfigSchema.parse({
        ...base,
        sync: { themes: { t: { mode: "partial" } } },
      }),
    ).toThrow();
  });
});

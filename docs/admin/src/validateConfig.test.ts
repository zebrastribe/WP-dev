import { describe, expect, it } from "vitest";
import { validateWpDevConfigJson } from "./validateConfig";
import { EXAMPLE_WP_DEV_CONFIG } from "./generated/exampleConfig";

describe("validateWpDevConfigJson", () => {
  it("accepts generated example config", () => {
    const result = validateWpDevConfigJson(EXAMPLE_WP_DEV_CONFIG);
    expect(result.ok).toBe(true);
  });

  it("rejects missing project", () => {
    const result = validateWpDevConfigJson({
      ...EXAMPLE_WP_DEV_CONFIG,
      project: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toMatch(/project/i);
    }
  });

  it("rejects invalid production url", () => {
    const result = validateWpDevConfigJson({
      ...EXAMPLE_WP_DEV_CONFIG,
      production: { ...EXAMPLE_WP_DEV_CONFIG.production, url: "not-a-url" },
    });
    expect(result.ok).toBe(false);
  });

  it("accepts sync plugin rules", () => {
    const result = validateWpDevConfigJson({
      ...EXAMPLE_WP_DEV_CONFIG,
      sync: {
        plugins: { "query-monitor": "localOnly" },
        themes: {
          "agency-starter": { mode: "custom", excludeFolders: ["src"] },
        },
      },
    });
    expect(result.ok).toBe(true);
  });
});

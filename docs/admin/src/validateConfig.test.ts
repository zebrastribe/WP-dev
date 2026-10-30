import { describe, expect, it } from "vitest";
import { normalizeWpDevConfigForSave, validateWpDevConfigJson } from "./validateConfig";
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

  it("rejects empty composeProjectName without normalization", () => {
    const result = validateWpDevConfigJson({
      ...EXAMPLE_WP_DEV_CONFIG,
      local: { ...EXAMPLE_WP_DEV_CONFIG.local, composeProjectName: "" },
    });
    expect(result.ok).toBe(false);
  });

  it("accepts empty composeProjectName after normalization", () => {
    const normalized = normalizeWpDevConfigForSave({
      ...EXAMPLE_WP_DEV_CONFIG,
      local: { ...EXAMPLE_WP_DEV_CONFIG.local, composeProjectName: "" },
    });
    const result = validateWpDevConfigJson(normalized);
    expect(result.ok).toBe(true);
    expect((normalized.local as Record<string, unknown>).composeProjectName).toBeUndefined();
  });

  it("rejects shell metacharacters in staging.host", () => {
    const badHosts = ["evil;id", "$(id)", "a b", "-oX", "host/path"];
    for (const badHost of badHosts) {
      const result = validateWpDevConfigJson({
        ...EXAMPLE_WP_DEV_CONFIG,
        staging: { ...EXAMPLE_WP_DEV_CONFIG.staging, host: badHost },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toMatch(/host/i);
      }
    }
  });

  it("rejects shell metacharacters in production.host", () => {
    const badHosts = ["evil;id", "$(id)", "a b", "-oX", "host/path"];
    for (const badHost of badHosts) {
      const result = validateWpDevConfigJson({
        ...EXAMPLE_WP_DEV_CONFIG,
        production: { ...EXAMPLE_WP_DEV_CONFIG.production, host: badHost },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors).toMatch(/host/i);
      }
    }
  });
});

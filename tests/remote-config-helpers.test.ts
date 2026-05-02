import { describe, expect, it } from "vitest";
import {
  expandUserPath,
  normalizeSiteUrl,
  parseOptionalPort,
} from "../src/utils/remote-config-helpers.js";

describe("expandUserPath", () => {
  it("expands tilde to include trailing segment", () => {
    expect(expandUserPath("~/foo")).toContain("foo");
  });
});

describe("normalizeSiteUrl", () => {
  it("adds https when missing", () => {
    expect(normalizeSiteUrl("staging.example.com", "https")).toBe(
      "https://staging.example.com",
    );
  });

  it("preserves existing scheme", () => {
    expect(normalizeSiteUrl("http://a.test", "https")).toBe("http://a.test");
  });
});

describe("parseOptionalPort", () => {
  it("returns undefined for blank", () => {
    expect(parseOptionalPort("")).toBeUndefined();
    expect(parseOptionalPort("   ")).toBeUndefined();
  });

  it("parses valid port", () => {
    expect(parseOptionalPort("2222")).toBe(2222);
  });

  it("throws for invalid", () => {
    expect(() => parseOptionalPort("abc")).toThrow();
  });
});

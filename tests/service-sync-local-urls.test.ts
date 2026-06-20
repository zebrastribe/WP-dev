import { describe, expect, it } from "vitest";
import {
  collectLoopbackUrlVariants,
  isLoopbackHost,
  normalizeLoopbackSiteUrl,
  shouldSyncLocalWordPressUrl,
} from "../src/services/sync-local-urls.js";

describe("service sync-local-urls helpers", () => {
  it("isLoopbackHost recognizes localhost variants", () => {
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("[::1]")).toBe(true);
    expect(isLoopbackHost("example.com")).toBe(false);
  });

  it("normalizeLoopbackSiteUrl normalizes loopback URLs", () => {
    expect(normalizeLoopbackSiteUrl("http://127.0.0.1:8894/")).toBe("http://localhost:8894");
    expect(normalizeLoopbackSiteUrl("https://example.com")).toBeUndefined();
  });

  it("shouldSyncLocalWordPressUrl detects port drift", () => {
    expect(shouldSyncLocalWordPressUrl("http://localhost:8889", "http://localhost:8894")).toBe(true);
    expect(shouldSyncLocalWordPressUrl("http://localhost:8894", "http://localhost:8894/")).toBe(false);
  });

  it("collectLoopbackUrlVariants dedupes with and without trailing slash", () => {
    const variants = collectLoopbackUrlVariants("http://localhost:8894");
    expect(variants).toContain("http://localhost:8894");
    expect(variants).toContain("http://localhost:8894/");
  });
});

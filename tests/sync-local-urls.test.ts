import { describe, expect, it } from "vitest";
import {
  collectLoopbackUrlVariants,
  isLoopbackHost,
  normalizeLoopbackSiteUrl,
  shouldSyncLocalWordPressUrl,
} from "../src/services/sync-local-urls.js";

describe("sync-local-urls", () => {
  it("detects loopback hosts", () => {
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("example.com")).toBe(false);
  });

  it("normalizes loopback URLs for comparison", () => {
    expect(normalizeLoopbackSiteUrl("http://127.0.0.1:8890/")).toBe("http://localhost:8890");
    expect(normalizeLoopbackSiteUrl("http://localhost:8890")).toBe("http://localhost:8890");
    expect(normalizeLoopbackSiteUrl("https://example.com")).toBeUndefined();
  });

  it("decides when loopback URLs need sync", () => {
    expect(shouldSyncLocalWordPressUrl("http://localhost:8889", "http://localhost:8892")).toBe(true);
    expect(shouldSyncLocalWordPressUrl("http://localhost:8892/", "http://localhost:8892")).toBe(false);
    expect(shouldSyncLocalWordPressUrl("https://timework.dk", "http://localhost:8892")).toBe(false);
  });

  it("collects loopback variants for search-replace", () => {
    const variants = collectLoopbackUrlVariants("http://localhost:8890", "http://127.0.0.1:8890/");
    expect(variants).toContain("http://localhost:8890");
    expect(variants).toContain("http://localhost:8890/");
    expect(variants.length).toBe(2);
  });
});

import { describe, expect, it } from "vitest";
import {
  collectStaleLoopbackUrls,
  getLoopbackReplaceCandidates,
  loopbackContentRegexPatterns,
  loopbackRedirectUsesWrongPort,
  normalizeSiteUrl,
} from "../src/utils/sync-local-urls.js";

describe("sync-local-urls", () => {
  it("collectStaleLoopbackUrls finds stale localhost ports", () => {
    const stale = collectStaleLoopbackUrls(
      "http://localhost:8889",
      "http://localhost:8889/",
      "http://localhost:8890",
    );
    expect(stale).toContain("http://localhost:8889");
    expect(stale.length).toBe(1);
  });

  it("collectStaleLoopbackUrls ignores matching expected URL", () => {
    expect(
      collectStaleLoopbackUrls(
        "http://localhost:8890",
        "http://localhost:8890",
        "http://localhost:8890",
      ),
    ).toEqual([]);
  });

  it("collectStaleLoopbackUrls ignores non-loopback URLs", () => {
    expect(
      collectStaleLoopbackUrls(
        "https://example.com",
        "https://www.example.com",
        "http://localhost:8890",
      ),
    ).toEqual([]);
  });

  it("getLoopbackReplaceCandidates includes localhost and 127.0.0.1 variants", () => {
    const candidates = getLoopbackReplaceCandidates("http://localhost:8889");
    expect(candidates).toContain("http://localhost:8889");
    expect(candidates).toContain("https://localhost:8889");
    expect(candidates).toContain("http://127.0.0.1:8889");
    expect(candidates).toContain("https://127.0.0.1:8889");
  });

  it("loopbackRedirectUsesWrongPort detects stale port in redirect", () => {
    expect(
      loopbackRedirectUsesWrongPort("http://localhost:8890", "http://localhost:8889/"),
    ).toEqual({ wrong: true, expectedPort: 8890, gotPort: 8889 });
  });

  it("loopbackRedirectUsesWrongPort ignores same port", () => {
    expect(
      loopbackRedirectUsesWrongPort("http://localhost:8890", "http://localhost:8890/wp-admin/"),
    ).toEqual({ wrong: false });
  });

  it("normalizeSiteUrl strips trailing slash", () => {
    expect(normalizeSiteUrl("http://localhost:8888/")).toBe("http://localhost:8888");
  });

  it("loopbackContentRegexPatterns targets stale localhost ports in content", () => {
    const patterns = loopbackContentRegexPatterns("http://localhost:8894");
    expect(patterns.some((p) => p.pattern.includes("[0-9]+"))).toBe(true);
    expect(patterns.every((p) => p.replacement === "http://localhost:8894")).toBe(true);
  });
});

import { describe, expect, it, vi, beforeEach } from "vitest";
import { probeHttpUrl } from "../src/utils/http-probe.js";

describe("probeHttpUrl", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns ok for 200 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 200,
        headers: { get: () => null },
      }),
    );
    const result = await probeHttpUrl("http://localhost:8888/");
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
  });

  it("follows redirects up to final URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          status: 301,
          headers: { get: () => "http://localhost:8888/wp-admin/" },
        })
        .mockResolvedValueOnce({
          status: 200,
          headers: { get: () => null },
        }),
    );
    const result = await probeHttpUrl("http://localhost:8888/");
    expect(result.ok).toBe(true);
    expect(result.finalUrl).toContain("/wp-admin/");
    expect(result.hops.length).toBeGreaterThan(0);
  });

  it("returns error on fetch failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const result = await probeHttpUrl("http://localhost:9999/");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("ECONNREFUSED");
  });

  it("returns too_many_redirects after 6 hops", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 302,
        headers: { get: () => "http://localhost:8888/loop" },
      }),
    );
    const result = await probeHttpUrl("http://localhost:8888/");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("too_many_redirects");
  });
});

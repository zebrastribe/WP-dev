import { describe, expect, it } from "vitest";
import {
  applyHttpAuthHtaccessBlock,
  buildHttpAuthHtaccessBlock,
  defaultStagingHttpAuth,
  HTTP_AUTH_BEGIN,
  HTTP_AUTH_END,
  maskSecret,
  stripHttpAuthHtaccessBlock,
} from "../src/services/staging-http-auth.js";

describe("staging-http-auth", () => {
  it("builds an AuthUserFile block with absolute htpasswd path", () => {
    const block = buildHttpAuthHtaccessBlock("/var/www/staging/.htpasswd");
    expect(block).toContain(HTTP_AUTH_BEGIN);
    expect(block).toContain("AuthType Basic");
    expect(block).toContain("AuthUserFile /var/www/staging/.htpasswd");
    expect(block).toContain("Require valid-user");
    expect(block).toContain(HTTP_AUTH_END);
  });

  it("merges without duplicating the WP-DEV block", () => {
    const first = applyHttpAuthHtaccessBlock("# WordPress\n", "/abs/.htpasswd");
    const second = applyHttpAuthHtaccessBlock(first, "/abs/.htpasswd");
    expect(second.split(HTTP_AUTH_BEGIN).length - 1).toBe(1);
    expect(second).toContain("# WordPress");
  });

  it("strips the WP-DEV HTTP AUTH block", () => {
    const withBlock = applyHttpAuthHtaccessBlock("KeepMe\n", "/abs/.htpasswd");
    expect(stripHttpAuthHtaccessBlock(withBlock).trim()).toBe("KeepMe");
  });

  it("masks secrets but keeps a short suffix", () => {
    expect(maskSecret("abcdefghijklmnop")).toMatch(/op$/);
    expect(maskSecret("abcdefghijklmnop")).not.toContain("abcdefgh");
  });

  it("default auth is enabled with username staging and a non-empty password", () => {
    const a = defaultStagingHttpAuth();
    expect(a.enabled).toBe(true);
    expect(a.username).toBe("staging");
    expect(a.password.length).toBeGreaterThan(8);
  });
});

import { describe, expect, it } from "vitest";
import { remoteWpPathFlag } from "../src/services/wpcli.js";

describe("remoteWpPathFlag", () => {
  it("uses single-quoted path only (no nested double quotes)", () => {
    const p = "/var/www/stri.be/public_html";
    const flag = remoteWpPathFlag(p);
    expect(flag).toBe(`--path='${p}'`);
    expect(flag).not.toContain('"');
    expect(flag).not.toMatch(/--path="/);
  });

  it("escapes single quotes in path without adding double quotes around shellQuote", () => {
    const flag = remoteWpPathFlag("/var/www/a'b/c");
    expect(flag).toBe(`--path='/var/www/a'\\''b/c'`);
    expect(flag).not.toMatch(/--path="/);
  });
});

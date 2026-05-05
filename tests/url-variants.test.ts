import { describe, expect, it } from "vitest";
import { getUrlVariants } from "../src/utils/url-variants.js";

describe("url-variants", () => {
  it("adds protocol and www variants for a domain", () => {
    const variants = getUrlVariants("https://example.com");
    expect(variants).toEqual([
      "https://example.com",
      "https://www.example.com",
      "http://example.com",
      "http://www.example.com",
    ]);
  });

  it("keeps localhost without www variants", () => {
    const variants = getUrlVariants("http://localhost:8891");
    expect(variants).toEqual(["http://localhost:8891", "https://localhost:8891"]);
  });
});

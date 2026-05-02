import { describe, expect, it } from "vitest";
import {
  domainPathSlug,
  parseMainDomain,
  suggestProduction,
  suggestStaging,
} from "../src/utils/domain-defaults.js";

describe("parseMainDomain", () => {
  it("normalizes URL and strips www", () => {
    expect(parseMainDomain("https://www.stri.be/path")).toBe("stri.be");
  });

  it("accepts plain domain", () => {
    expect(parseMainDomain("stri.be")).toBe("stri.be");
  });
});

describe("domainPathSlug", () => {
  it("maps dots to hyphens", () => {
    expect(domainPathSlug("stri.be")).toBe("stri-be");
  });

  it("handles multi-label", () => {
    expect(domainPathSlug("shop.example.co.uk")).toBe("shop-example-co-uk");
  });
});

describe("suggestStaging / suggestProduction", () => {
  it("uses slug in path", () => {
    const st = suggestStaging("stri.be");
    expect(st.path).toBe("/var/www/stri-be");
    expect(st.host).toBe("staging.stri.be");
    const pr = suggestProduction("stri.be");
    expect(pr.path).toBe("/var/www/stri-be");
    expect(pr.host).toBe("stri.be");
  });
});

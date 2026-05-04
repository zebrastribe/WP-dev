import { describe, expect, it } from "vitest";
import {
  findSimplyProductForApex,
  isPlausibleIpv4,
  pickStagingTargetIpv4,
  sanitizeStagingDnsLabel,
} from "../src/services/simply-staging.js";

describe("sanitizeStagingDnsLabel", () => {
  it("normalizes valid labels", () => {
    expect(sanitizeStagingDnsLabel("Dev")).toBe("dev");
    expect(sanitizeStagingDnsLabel("stg-1")).toBe("stg-1");
  });
  it("rejects invalid", () => {
    expect(() => sanitizeStagingDnsLabel("")).toThrow();
    expect(() => sanitizeStagingDnsLabel("-bad")).toThrow();
    expect(() => sanitizeStagingDnsLabel("bad-")).toThrow();
  });
});

describe("isPlausibleIpv4", () => {
  it("accepts valid quads", () => {
    expect(isPlausibleIpv4("1.2.3.4")).toBe(true);
    expect(isPlausibleIpv4("192.168.0.1")).toBe(true);
  });
  it("rejects invalid", () => {
    expect(isPlausibleIpv4("256.1.1.1")).toBe(false);
    expect(isPlausibleIpv4("x")).toBe(false);
  });
});

describe("findSimplyProductForApex", () => {
  it("matches domain.name", () => {
    const p = findSimplyProductForApex(
      [
        { object: "other.com", cancelled: false, domain: { name: "other.com" } },
        { object: "stri.be", cancelled: false, domain: { name: "stri.be" } },
      ],
      "stri.be",
    );
    expect(p?.object).toBe("stri.be");
  });
  it("skips cancelled", () => {
    const p = findSimplyProductForApex(
      [{ object: "x", cancelled: true, domain: { name: "x" } }],
      "x",
    );
    expect(p).toBeUndefined();
  });
});

describe("pickStagingTargetIpv4", () => {
  const apex = "stri.be";
  const records = [
    { name: "stri.be", type: "A", data: "10.0.0.1" },
    { name: "www.stri.be", type: "A", data: "203.0.113.7" },
  ];

  it("prefers webserver IP from product", () => {
    const ip = pickStagingTargetIpv4(
      {
        object: "stri.be",
        servers: { webserver: { ip: "198.51.100.2" } },
      },
      records,
      apex,
    );
    expect(ip).toBe("198.51.100.2");
  });

  it("falls back to apex then www A record", () => {
    expect(
      pickStagingTargetIpv4({ object: "stri.be" }, [{ name: "stri.be", type: "A", data: "10.0.0.2" }], apex),
    ).toBe("10.0.0.2");
    expect(pickStagingTargetIpv4({ object: "stri.be" }, records, apex)).toBe("10.0.0.1");
    expect(
      pickStagingTargetIpv4(
        { object: "stri.be" },
        [{ name: "www.stri.be", type: "A", data: "203.0.113.9" }],
        apex,
      ),
    ).toBe("203.0.113.9");
  });
});

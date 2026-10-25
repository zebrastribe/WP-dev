import { describe, expect, it } from "vitest";
import { assertTablePrefixesCompatible } from "../src/services/wpcli.js";

describe("assertTablePrefixesCompatible", () => {
  it("allows matching prefixes", () => {
    expect(() => assertTablePrefixesCompatible("wp_", "wp_", "push staging")).not.toThrow();
  });

  it("refuses mismatch", () => {
    expect(() => assertTablePrefixesCompatible("wp_", "xyz_", "push staging")).toThrow(
      /table_prefix mismatch/,
    );
  });

  it("refuses missing either side", () => {
    expect(() => assertTablePrefixesCompatible(undefined, "wp_", "push")).toThrow(
      /could not read table_prefix/,
    );
    expect(() => assertTablePrefixesCompatible("wp_", "", "push")).toThrow(
      /could not read table_prefix/,
    );
  });
});

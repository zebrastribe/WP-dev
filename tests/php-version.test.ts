import { describe, expect, it } from "vitest";
import {
  assertSupportedPhpVersion,
  SUPPORTED_PHP_VERSIONS,
} from "../src/services/php-version.js";

describe("php-version", () => {
  it("accepts supported versions", () => {
    for (const v of SUPPORTED_PHP_VERSIONS) {
      expect(() => assertSupportedPhpVersion(v)).not.toThrow();
    }
  });

  it("rejects unknown versions", () => {
    expect(() => assertSupportedPhpVersion("5.6")).toThrow(/Unsupported PHP version/);
    expect(() => assertSupportedPhpVersion("9.0")).toThrow(/Unsupported PHP version/);
  });
});

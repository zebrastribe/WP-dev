import { describe, expect, it } from "vitest";
import { isPlaceholderRemoteHost } from "../src/utils/remote-placeholder.js";

describe("isPlaceholderRemoteHost", () => {
  it("treats .invalid as placeholder", () => {
    expect(isPlaceholderRemoteHost("staging.example.invalid")).toBe(true);
  });

  it("does not flag normal hosts", () => {
    expect(isPlaceholderRemoteHost("linux159.unoeuro.com")).toBe(false);
    expect(isPlaceholderRemoteHost("stri.be")).toBe(false);
    expect(isPlaceholderRemoteHost("localhost")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { wpDevConfigSchema } from "../src/config/schema.js";
import {
  isPlaceholderRemoteHost,
  isStagingRemotePlaceholder,
  STAGING_PLACEHOLDER_SSH_PATH,
} from "../src/utils/remote-placeholder.js";

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

function minimalConfig(
  staging: { host: string; path: string; url: string },
): ReturnType<typeof wpDevConfigSchema.parse> {
  return wpDevConfigSchema.parse({
    project: "t",
    local: {
      url: "http://localhost:8888",
      path: "./docker",
      wpRoot: "./wordpress",
    },
    staging: { ...staging, user: "u" },
    production: {
      host: "p.test",
      user: "u",
      path: "/var/www/p",
      url: "https://p.test",
    },
  });
}

describe("isStagingRemotePlaceholder", () => {
  it("detects .invalid staging host", () => {
    const c = minimalConfig({
      host: "staging.example.invalid",
      path: "/var/www/x",
      url: "https://staging.example.invalid",
    });
    expect(isStagingRemotePlaceholder(c)).toBe(true);
  });

  it("detects placeholder staging path", () => {
    const c = minimalConfig({
      host: "staging.real.test",
      path: STAGING_PLACEHOLDER_SSH_PATH,
      url: "https://staging.real.test",
    });
    expect(isStagingRemotePlaceholder(c)).toBe(true);
  });

  it("returns false for real staging", () => {
    const c = minimalConfig({
      host: "staging.stri.be",
      path: "/var/www/stri.be",
      url: "https://staging.stri.be",
    });
    expect(isStagingRemotePlaceholder(c)).toBe(false);
  });
});

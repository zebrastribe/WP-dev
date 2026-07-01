import { describe, expect, it, vi, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import * as os from "node:os";
import {
  expandUserPath,
  normalizeSiteUrl,
  parseOptionalPort,
  preferTildePath,
  resolveIdentityFile,
} from "../src/utils/remote-config-helpers.js";

describe("expandUserPath", () => {
  it("expands tilde to include trailing segment", () => {
    expect(expandUserPath("~/foo")).toContain("foo");
  });
});

describe("normalizeSiteUrl", () => {
  it("adds https when missing", () => {
    expect(normalizeSiteUrl("staging.example.com", "https")).toBe(
      "https://staging.example.com",
    );
  });

  it("preserves existing scheme", () => {
    expect(normalizeSiteUrl("http://a.test", "https")).toBe("http://a.test");
  });
});

describe("parseOptionalPort", () => {
  it("returns undefined for blank", () => {
    expect(parseOptionalPort("")).toBeUndefined();
    expect(parseOptionalPort("   ")).toBeUndefined();
  });

  it("parses valid port", () => {
    expect(parseOptionalPort("2222")).toBe(2222);
  });

  it("throws for invalid", () => {
    expect(() => parseOptionalPort("abc")).toThrow();
  });
});

describe("resolveIdentityFile", () => {
  const created: string[] = [];

  afterEach(() => {
    for (const path of created.splice(0)) {
      rmSync(path, { force: true });
    }
  });

  it("expands tilde paths under the current home", () => {
    const sshDir = join(os.homedir(), ".ssh");
    mkdirSync(sshDir, { recursive: true });
    const keyName = `wp-dev-test-tilde-${process.pid}.pem`;
    const keyPath = join(sshDir, keyName);
    writeFileSync(keyPath, "fake-key");
    created.push(keyPath);
    expect(resolveIdentityFile(`~/.ssh/${keyName}`)).toBe(keyPath);
  });

  it("remaps a foreign host absolute .ssh path to local ~/.ssh", () => {
    const sshDir = join(os.homedir(), ".ssh");
    mkdirSync(sshDir, { recursive: true });
    const keyName = `wp-dev-test-remap-${process.pid}.pem`;
    const keyPath = join(sshDir, keyName);
    writeFileSync(keyPath, "fake-key");
    created.push(keyPath);
    expect(resolveIdentityFile(`/home/other-user/.ssh/${keyName}`)).toBe(keyPath);
  });

  it("preferTildePath shortens paths under home", () => {
    expect(preferTildePath(join(os.homedir(), ".ssh", "id_ed25519"))).toBe("~/.ssh/id_ed25519");
  });
});

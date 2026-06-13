import { describe, expect, it } from "vitest";
import {
  adminSaveTokenHint,
  dockerStartHint,
  isMacOs,
  openBrowserCommand,
  sshKeySetupHint,
} from "../src/utils/platform-hints.js";

describe("platform-hints", () => {
  it("openBrowserCommand returns open on darwin only", () => {
    const url = "http://localhost:8888/admin/";
    if (process.platform === "darwin") {
      expect(openBrowserCommand(url)).toBe(`open "${url}"`);
    } else {
      expect(openBrowserCommand(url)).toBeUndefined();
    }
  });

  it("openBrowserCommand escapes quotes in URL", () => {
    if (process.platform !== "darwin") return;
    expect(openBrowserCommand('http://x/"y"')).toBe('open "http://x/\\"y\\""');
  });

  it("dockerStartHint mentions Docker Desktop on macOS", () => {
    const hint = dockerStartHint();
    if (isMacOs()) {
      expect(hint).toMatch(/Docker Desktop/i);
    } else {
      expect(hint).toMatch(/Docker daemon/i);
    }
  });

  it("sshKeySetupHint mentions apple-use-keychain on macOS", () => {
    const hint = sshKeySetupHint();
    if (isMacOs()) {
      expect(hint).toMatch(/apple-use-keychain/);
    } else {
      expect(hint).toMatch(/ssh-keygen/);
    }
  });

  it("adminSaveTokenHint mentions docker/.env", () => {
    expect(adminSaveTokenHint()).toMatch(/docker\/\.env/);
  });
});

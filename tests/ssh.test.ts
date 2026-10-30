import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import * as os from "node:os";
import {
  buildBaseConnectOptions,
  buildSshConnectAttempts,
  expandHomePath,
  checkSshPreflight,
  formatSshAuthError,
  detectPassphraseProtectedKey,
} from "../src/utils/ssh-helpers.js";
import { buildSshPinCommand } from "../src/utils/ssh-host-key.js";

const connectMock = vi.fn();
const disposeMock = vi.fn();

vi.mock("node-ssh", () => ({
  NodeSSH: class {
    connect = connectMock;
    execCommand = vi.fn();
    getFile = vi.fn();
    putFile = vi.fn();
    dispose = disposeMock;
  },
}));

describe("ssh-helpers", () => {
  beforeEach(() => {
    process.env.WPDEV_SSH_INSECURE = "1";
  });

  const remote = {
    host: "linux.example.com",
    user: "deploy",
    path: "/var/www/html",
    url: "https://linux.example.com",
    port: 22,
    identityFile: "~/custom_key",
  };

  it("expandHomePath expands tilde paths", () => {
    expect(expandHomePath("~/keys/id")).toContain("/keys/id");
    expect(expandHomePath("/abs/path")).toBe("/abs/path");
  });

  it("buildBaseConnectOptions sets host user and port", () => {
    const opts = buildBaseConnectOptions(remote);
    expect(opts.host).toBe("linux.example.com");
    expect(opts.username).toBe("deploy");
    expect(opts.port).toBe(22);
    expect(opts.tryKeyboard).toBe(false);
  });

  it("buildSshConnectAttempts includes agent when SSH_AUTH_SOCK set", () => {
    const prev = process.env.SSH_AUTH_SOCK;
    process.env.SSH_AUTH_SOCK = "/tmp/ssh-agent.sock";
    const attempts = buildSshConnectAttempts(remote);
    expect(attempts.some((a) => a.label.includes("ssh-agent"))).toBe(true);
    if (prev === undefined) delete process.env.SSH_AUTH_SOCK;
    else process.env.SSH_AUTH_SOCK = prev;
  });
});

describe("buildSshPinCommand", () => {
  beforeEach(() => {
    process.env.WPDEV_SSH_INSECURE = "1";
  });

  it("builds basic command", () => {
    const cmd = buildSshPinCommand({ host: "example.com", user: "deploy", path: "/var/www", url: "https://example.com" });
    expect(cmd).toBe("ssh deploy@example.com");
  });

  it("includes port when non-default", () => {
    const cmd = buildSshPinCommand({ host: "example.com", user: "deploy", path: "/var/www", url: "https://example.com", port: 2222 });
    expect(cmd).toBe("ssh -p 2222 deploy@example.com");
  });

  it("includes identity file when configured", () => {
    const sshDir = join(os.homedir(), ".ssh");
    mkdirSync(sshDir, { recursive: true });
    const keyPath = join(sshDir, `test-pin-${process.pid}.pem`);
    writeFileSync(keyPath, "fake-key");
    try {
      const cmd = buildSshPinCommand({
        host: "example.com",
        user: "deploy",
        path: "/var/www",
        url: "https://example.com",
        identityFile: `~/.ssh/test-pin-${process.pid}.pem`,
      });
      expect(cmd).toContain(`-i ${keyPath}`);
      expect(cmd).toContain("deploy@example.com");
    } finally {
      rmSync(keyPath, { force: true });
    }
  });
});

describe("checkSshPreflight", () => {
  let tempDir: string;

  beforeEach(() => {
    process.env.WPDEV_SSH_INSECURE = "1";
    tempDir = mkdtempSync(join(os.tmpdir(), "ssh-preflight-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns ok when no identity file configured", () => {
    const result = checkSshPreflight({ host: "example.com", user: "deploy", path: "/var/www", url: "https://example.com" });
    expect(result.ok).toBe(true);
  });

  it("errors when configured identity file missing and no agent", () => {
    const prev = process.env.SSH_AUTH_SOCK;
    delete process.env.SSH_AUTH_SOCK;
    try {
      const result = checkSshPreflight({
        host: "example.com",
        user: "deploy",
        path: "/var/www",
        url: "https://example.com",
        identityFile: "/nonexistent/key.pem",
      });
      expect(result.ok).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain("not found");
    } finally {
      if (prev === undefined) delete process.env.SSH_AUTH_SOCK;
      else process.env.SSH_AUTH_SOCK = prev;
    }
  });

  it("warns when configured identity file missing but agent available", () => {
    const prev = process.env.SSH_AUTH_SOCK;
    process.env.SSH_AUTH_SOCK = "/tmp/ssh-agent.sock";
    try {
      const result = checkSshPreflight({
        host: "example.com",
        user: "deploy",
        path: "/var/www",
        url: "https://example.com",
        identityFile: "/nonexistent/key.pem",
      });
      expect(result.ok).toBe(true);
      expect(result.warnings.some((w) => w.includes("not found") && w.includes("ssh-agent"))).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.SSH_AUTH_SOCK;
      else process.env.SSH_AUTH_SOCK = prev;
    }
  });

  it("warns on insecure key permissions", () => {
    const keyPath = join(tempDir, "insecure-key");
    writeFileSync(keyPath, "fake-key", { mode: 0o644 });
    const result = checkSshPreflight({
      host: "example.com",
      user: "deploy",
      path: "/var/www",
      url: "https://example.com",
      identityFile: keyPath,
    });
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.includes("permissions") || w.includes("chmod 600"))).toBe(true);
  });
});

describe("formatSshAuthError", () => {
  beforeEach(() => {
    process.env.WPDEV_SSH_INSECURE = "1";
  });

  it("formats publickey denied error with guidance", () => {
    const msg = formatSshAuthError(
      { host: "example.com", user: "deploy", path: "/var/www", url: "https://example.com" },
      [{ label: "key ~/.ssh/id_ed25519", message: "All configured authentication methods failed" }],
    );
    expect(msg).toContain("SSH authentication failed");
    expect(msg).toContain("deploy@example.com");
    expect(msg).toContain("authorized_keys");
  });

  it("includes missing key info when configured file missing", () => {
    const msg = formatSshAuthError(
      { host: "example.com", user: "deploy", path: "/var/www", url: "https://example.com", identityFile: "/nonexistent/key.pem" },
      [{ label: "default auth", message: "timeout" }],
    );
    expect(msg).toContain("not found");
    expect(msg).toContain("/nonexistent/key.pem");
  });

  it("includes port in target when non-default", () => {
    const msg = formatSshAuthError(
      { host: "example.com", user: "deploy", path: "/var/www", url: "https://example.com", port: 2222 },
      [{ label: "test", message: "fail" }],
    );
    expect(msg).toContain("deploy@example.com:2222");
  });
});

describe("detectPassphraseProtectedKey", () => {
  let tempDir: string;
  let hasSshKeygen = true;

  beforeEach(() => {
    tempDir = mkdtempSync(join(os.tmpdir(), "passphrase-detect-"));
    const check = spawnSync("ssh-keygen", ["-h"], { encoding: "utf8", timeout: 2000 });
    hasSshKeygen = check.status !== null;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("detects passphrase-protected key via ssh-keygen", () => {
    if (!hasSshKeygen) return;
    const keyPath = join(tempDir, "test-key-protected");
    const result = spawnSync("ssh-keygen", ["-t", "ed25519", "-N", "testpass", "-f", keyPath, "-q"], {
      encoding: "utf8",
      timeout: 10000,
    });
    if (result.status !== 0) return;
    expect(detectPassphraseProtectedKey(keyPath)).toBe(true);
  });

  it("returns false for unprotected key", () => {
    if (!hasSshKeygen) return;
    const keyPath = join(tempDir, "test-key-plain");
    const result = spawnSync("ssh-keygen", ["-t", "ed25519", "-N", "", "-f", keyPath, "-q"], {
      encoding: "utf8",
      timeout: 10000,
    });
    if (result.status !== 0) return;
    expect(detectPassphraseProtectedKey(keyPath)).toBe(false);
  });

  it("returns false for nonexistent file", () => {
    expect(detectPassphraseProtectedKey("/nonexistent/key")).toBe(false);
  });
});

describe("connectSsh", () => {
  beforeEach(() => {
    process.env.WPDEV_SSH_INSECURE = "1";
    connectMock.mockReset();
    connectMock.mockResolvedValue(undefined);
  });

  it("connects on first successful attempt", async () => {
    const { connectSsh } = await import("../src/services/ssh.js");
    const session = await connectSsh({
      host: "h",
      user: "u",
      path: "/p",
      url: "https://h",
    });
    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(typeof session.exec).toBe("function");
    session.dispose();
  });

  it("throws aggregated errors when all attempts fail", async () => {
    connectMock.mockRejectedValue(new Error("auth failed"));
    const { connectSsh } = await import("../src/services/ssh.js");
    await expect(
      connectSsh({ host: "h", user: "u", path: "/p", url: "https://h" }),
    ).rejects.toThrow(/SSH authentication failed/);
  });
});

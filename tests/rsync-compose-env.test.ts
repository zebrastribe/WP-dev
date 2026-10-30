import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import * as os from "node:os";
import {
  buildSshRsyncEnv,
  canRetryPullWithRelativePath,
  canRetryPushWithRelativePath,
  pullRsyncFailureHint,
  pushRsyncFailureHint,
  classifyRsyncSshError,
  formatRsyncSshErrorHint,
} from "../src/utils/rsync-ssh-env.js";

const execaMock = vi.fn();
vi.mock("execa", () => ({
  execa: (...args: unknown[]) => execaMock(...args),
}));

describe("rsync-ssh-env helpers", () => {
  it("buildSshRsyncEnv includes port and resolved identity file", () => {
    const sshDir = join(os.homedir(), ".ssh");
    mkdirSync(sshDir, { recursive: true });
    const keyName = `wp-dev-test-${process.pid}.pem`;
    const keyPath = join(sshDir, keyName);
    writeFileSync(keyPath, "fake-key");

    const env = buildSshRsyncEnv({
      host: "example.com",
      user: "deploy",
      path: "/var/www",
      url: "https://example.com",
      port: 2222,
      identityFile: `~/.ssh/${keyName}`,
    });
    expect(env).toContain("-p 2222");
    expect(env).toContain(`-i '${keyPath}'`);
    expect(env).toContain("-F /dev/null");
    expect(env).toContain("UserKnownHostsFile=");
    expect(env).toContain("BatchMode=yes");
    expect(env).toContain("StrictHostKeyChecking=yes");
    expect(env).not.toContain("accept-new");
    expect(env).toContain("ServerAliveInterval=30");
    expect(env).toContain("TCPKeepAlive=yes");

    rmSync(keyPath, { force: true });
  });

  it("detects pull relative-path retry", () => {
    expect(canRetryPullWithRelativePath("/var/www/html", "change_dir #1 failed")).toBe(true);
    expect(canRetryPullWithRelativePath("staging", "change_dir failed")).toBe(false);
  });

  it("detects push relative-path retry only for destination root mkdir", () => {
    expect(
      canRetryPushWithRelativePath(
        "/var/www/html",
        'mkdir "/var/www/html" failed: Permission denied',
      ),
    ).toBe(true);
    expect(
      canRetryPushWithRelativePath(
        "/var/www/html",
        "recv_generator: mkdir /var/www/html failed: Permission denied",
      ),
    ).toBe(true);
    // Mid-tree failure must NOT trigger absolute→relative retry (wrong tree risk).
    expect(
      canRetryPushWithRelativePath(
        "/var/www/html",
        "mkdir /var/www/html/wp-content failed: Permission denied",
      ),
    ).toBe(false);
    expect(canRetryPushWithRelativePath("/var/www/html", "other error")).toBe(false);
  });

  it("buildSshRsyncEnv quotes identity file path", () => {
    const sshDir = join(os.homedir(), ".ssh");
    mkdirSync(sshDir, { recursive: true });
    const keyName = `wp-dev-quote-${process.pid}.pem`;
    const keyPath = join(sshDir, keyName);
    writeFileSync(keyPath, "fake-key");
    const env = buildSshRsyncEnv({
      host: "example.com",
      user: "deploy",
      path: "/var/www",
      url: "https://example.com",
      identityFile: `~/.ssh/${keyName}`,
    });
    expect(env).toContain(`-i '${keyPath}'`);
    rmSync(keyPath, { force: true });
  });

  it("pullRsyncFailureHint suggests fix-permissions for local permission errors", () => {
    expect(pullRsyncFailureHint("mkstemp failed")).toContain("fix-permissions");
  });

  it("pushRsyncFailureHint mentions remote path for mkdir errors", () => {
    expect(
      pushRsyncFailureHint("mkdir /customers/foo failed: Permission denied", "staging"),
    ).toContain("staging");
  });

  it("buildSshRsyncEnv includes IdentitiesOnly=yes when identity file configured", () => {
    const sshDir = join(os.homedir(), ".ssh");
    mkdirSync(sshDir, { recursive: true });
    const keyName = `wp-dev-identity-only-${process.pid}.pem`;
    const keyPath = join(sshDir, keyName);
    writeFileSync(keyPath, "fake-key");

    const env = buildSshRsyncEnv({
      host: "example.com",
      user: "deploy",
      path: "/var/www",
      url: "https://example.com",
      identityFile: `~/.ssh/${keyName}`,
    });
    expect(env).toContain("IdentitiesOnly=yes");
    expect(env).toContain(`-i '${keyPath}'`);

    rmSync(keyPath, { force: true });
  });
});

describe("classifyRsyncSshError", () => {
  it("classifies unprotected key file error", () => {
    expect(classifyRsyncSshError("UNPROTECTED PRIVATE KEY FILE!")).toBe("unprotected_key");
    expect(classifyRsyncSshError("Permissions 0644 are too open")).toBe("unprotected_key");
  });

  it("classifies publickey denied error", () => {
    expect(classifyRsyncSshError("Permission denied (publickey)")).toBe("publickey_denied");
    expect(classifyRsyncSshError("All configured authentication methods failed")).toBe("publickey_denied");
  });

  it("classifies host not pinned error", () => {
    expect(classifyRsyncSshError("Host key verification failed")).toBe("host_not_pinned");
    expect(classifyRsyncSshError("No ED25519 host key is known")).toBe("host_not_pinned");
  });

  it("classifies local permission error", () => {
    expect(classifyRsyncSshError("mkstemp wordpress/test: Permission denied")).toBe("local_permission");
  });

  it("classifies remote permission error", () => {
    expect(classifyRsyncSshError("mkdir /var/www/html failed: Permission denied")).toBe("remote_permission");
    expect(classifyRsyncSshError("recv_generator: mkdir failed: Permission denied")).toBe("remote_permission");
  });

  it("returns unknown for unrecognized errors", () => {
    expect(classifyRsyncSshError("some random error")).toBe("unknown");
  });
});

describe("formatRsyncSshErrorHint", () => {
  it("provides chmod hint for unprotected key", () => {
    const hint = formatRsyncSshErrorHint("unprotected_key", "~/.ssh/my-key");
    expect(hint).toContain("chmod 600");
    expect(hint).toContain("~/.ssh/my-key");
  });

  it("provides authorized_keys hint for publickey denied", () => {
    const hint = formatRsyncSshErrorHint("publickey_denied", "~/.ssh/id_ed25519");
    expect(hint).toContain("authorized_keys");
    expect(hint).toContain("~/.ssh/id_ed25519.pub");
  });

  it("provides pin hint for host not pinned", () => {
    const hint = formatRsyncSshErrorHint("host_not_pinned");
    expect(hint).toContain("pin");
    expect(hint).toContain("fingerprint");
  });

  it("provides fix-permissions hint for local permission error", () => {
    const hint = formatRsyncSshErrorHint("local_permission");
    expect(hint).toContain("fix-permissions");
  });

  it("returns empty string for unknown errors", () => {
    expect(formatRsyncSshErrorHint("unknown")).toBe("");
  });
});

describe("pullRsyncFailureHint error classification", () => {
  it("suggests chmod for unprotected key error", () => {
    const hint = pullRsyncFailureHint("UNPROTECTED PRIVATE KEY FILE!", "~/.ssh/my-key");
    expect(hint).toContain("chmod 600");
    expect(hint).not.toContain("fix-permissions");
  });

  it("suggests authorized_keys for publickey denied", () => {
    const hint = pullRsyncFailureHint("Permission denied (publickey)", "~/.ssh/id_ed25519");
    expect(hint).toContain("authorized_keys");
    expect(hint).not.toContain("fix-permissions");
  });

  it("suggests fix-permissions only for local docker ownership issues", () => {
    const hint = pullRsyncFailureHint("mkstemp wordpress/test: Permission denied");
    expect(hint).toContain("fix-permissions");
  });
});

describe("rsyncPull / rsyncPush", () => {
  const remote = {
    host: "host.example",
    user: "u",
    path: "/var/www/html",
    url: "https://host.example",
  };

  beforeEach(() => {
    execaMock.mockReset();
    process.env.WPDEV_RSYNC_RETRY_BASE_MS = "0";
  });

  afterEach(() => {
    delete process.env.WPDEV_RSYNC_RETRY_BASE_MS;
  });

  it("rsyncPull succeeds on first attempt", async () => {
    execaMock.mockResolvedValueOnce({ exitCode: 0, stderr: "" });
    const { rsyncPull } = await import("../src/services/rsync.js");
    await rsyncPull(remote, "/tmp/wp", { dryRun: false });
    expect(execaMock).toHaveBeenCalledTimes(1);
    expect(execaMock.mock.calls[0][0]).toBe("rsync");
    const args = execaMock.mock.calls[0][1] as string[];
    expect(args).toContain("--partial");
    expect(args).toContain("--timeout=300");
  });

  it("rsyncPull retries on connection reset then succeeds", async () => {
    execaMock
      .mockResolvedValueOnce({ exitCode: 255, stderr: "Connection reset by peer" })
      .mockResolvedValueOnce({ exitCode: 0, stderr: "" });
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { rsyncPull } = await import("../src/services/rsync.js");
    await rsyncPull(remote, "/tmp/wp", { dryRun: false });
    expect(execaMock).toHaveBeenCalledTimes(2);
    expect(stderrSpy.mock.calls.some((c) => String(c[0]).includes("connection dropped"))).toBe(
      true,
    );
    stderrSpy.mockRestore();
  });

  it("rsyncPull retries with relative path on change_dir failure", async () => {
    execaMock
      .mockResolvedValueOnce({ exitCode: 23, stderr: "change_dir #1 failed" })
      .mockResolvedValueOnce({ exitCode: 0, stderr: "" });
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const { rsyncPull } = await import("../src/services/rsync.js");
    await rsyncPull(remote, "/tmp/wp", { dryRun: false });
    expect(execaMock).toHaveBeenCalledTimes(2);
    stderrSpy.mockRestore();
  });

  it("rsyncPull throws with hint on permission error", async () => {
    execaMock.mockResolvedValueOnce({ exitCode: 23, stderr: "mkstemp: Permission denied" });
    const { rsyncPull } = await import("../src/services/rsync.js");
    await expect(rsyncPull(remote, "/tmp/wp", { dryRun: false })).rejects.toThrow(/fix-permissions/);
  });

  it("rsyncPush succeeds on first attempt", async () => {
    execaMock.mockResolvedValueOnce({ exitCode: 0, stderr: "" });
    const { rsyncPush } = await import("../src/services/rsync.js");
    await rsyncPush(remote, "/tmp/wp", { dryRun: true });
    const args = execaMock.mock.calls[0][1] as string[];
    expect(args).toContain("--dry-run");
  });
});

describe("compose-env", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(os.tmpdir(), "wp-dev-env-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("setPortInEnvFile updates and appends keys", async () => {
    const { setPortInEnvFile, readEnvValue } = await import("../src/utils/compose-env.js");
    const path = join(dir, ".env");
    writeFileSync(path, "WP_PORT=8888\n");
    setPortInEnvFile(path, "WPDEV_TERMINAL_PORT", 7681);
    const content = readFileSync(path, "utf8");
    expect(readEnvValue(content, "WP_PORT")).toBe("8888");
    expect(readEnvValue(content, "WPDEV_TERMINAL_PORT")).toBe("7681");
  });

  it("writeEnvFile keeps the same inode (file bind-mount safe)", async () => {
    const { writeEnvFile, readEnvValue } = await import("../src/utils/compose-env.js");
    const path = join(dir, ".env");
    writeFileSync(path, "WP_PORT=8888\n", { mode: 0o660 });
    const before = statSync(path).ino;
    writeEnvFile(path, "WP_PORT=8894\nWORDPRESS_TABLE_PREFIX=wp_\n");
    const after = statSync(path);
    expect(after.ino).toBe(before);
    expect(readEnvValue(readFileSync(path, "utf8"), "WP_PORT")).toBe("8894");
    expect(statSync(`${path}.bak`).isFile()).toBe(true);
  });

  it("parseDockerEnvPorts applies defaults", async () => {
    const { parseDockerEnvPorts } = await import("../src/utils/compose-env.js");
    const ports = parseDockerEnvPorts("WP_PORT=9000\n");
    expect(ports.WP_PORT).toBe(9000);
    expect(ports.WPDEV_TERMINAL_PORT).toBe(7681);
  });

  it("extractBoundPort parses docker bind errors", async () => {
    const { extractBoundPort, resolveConflictPortKey, parseDockerEnvPorts } = await import(
      "../src/utils/compose-env.js"
    );
    expect(extractBoundPort("Bind for 0.0.0.0:8888 failed: port is already allocated")).toBe(8888);
    const ports = parseDockerEnvPorts("WP_PORT=8888\nWP_HTTPS_PORT=8443\n");
    expect(resolveConflictPortKey(8443, ports)).toBe("WP_HTTPS_PORT");
  });

  it("runnerOriginPortMismatch detects localhost port drift", async () => {
    const { runnerOriginPortMismatch } = await import("../src/utils/compose-env.js");
    expect(runnerOriginPortMismatch("http://localhost:8888", 8890)).toBe(true);
    expect(runnerOriginPortMismatch("http://localhost:8890", 8890)).toBe(false);
    expect(runnerOriginPortMismatch("https://example.com", 8890)).toBe(false);
  });
});

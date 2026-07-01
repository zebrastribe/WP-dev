import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import * as os from "node:os";
import {
  buildSshRsyncEnv,
  canRetryPullWithRelativePath,
  canRetryPushWithRelativePath,
  pullRsyncFailureHint,
  pushRsyncFailureHint,
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
    expect(env).toContain(`-i ${keyPath}`);
    expect(env).toContain("BatchMode=yes");

    rmSync(keyPath, { force: true });
  });

  it("detects pull relative-path retry", () => {
    expect(canRetryPullWithRelativePath("/var/www/html", "change_dir #1 failed")).toBe(true);
    expect(canRetryPullWithRelativePath("staging", "change_dir failed")).toBe(false);
  });

  it("detects push relative-path retry", () => {
    expect(
      canRetryPushWithRelativePath("/var/www/html", "mkdir /customers/foo failed: Permission denied"),
    ).toBe(true);
    expect(canRetryPushWithRelativePath("/var/www/html", "other error")).toBe(false);
  });

  it("pullRsyncFailureHint suggests fix-permissions", () => {
    expect(pullRsyncFailureHint("mkstemp failed")).toContain("fix-permissions");
  });

  it("pushRsyncFailureHint mentions remote path for mkdir errors", () => {
    expect(
      pushRsyncFailureHint("mkdir /customers/foo failed: Permission denied", "staging"),
    ).toContain("staging");
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
  });

  it("rsyncPull succeeds on first attempt", async () => {
    execaMock.mockResolvedValueOnce({ exitCode: 0, stderr: "" });
    const { rsyncPull } = await import("../src/services/rsync.js");
    await rsyncPull(remote, "/tmp/wp", { dryRun: false });
    expect(execaMock).toHaveBeenCalledTimes(1);
    expect(execaMock.mock.calls[0][0]).toBe("rsync");
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

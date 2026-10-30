import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

describe("start-terminal-services.sh with stub binaries", () => {
  let tempDir: string;
  let stubBinDir: string;
  let stubLogDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "wp-dev-terminal-services-"));
    stubBinDir = join(tempDir, "bin");
    stubLogDir = join(tempDir, "logs");
    mkdirSync(stubBinDir, { recursive: true });
    mkdirSync(stubLogDir, { recursive: true });
    chmodSync(stubBinDir, 0o755);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function createStub(name: string, script: string) {
    const path = join(stubBinDir, name);
    writeFileSync(path, script);
    chmodSync(path, 0o755);
    return path;
  }

  it("rejects default WPDEV_TERMINAL_AUTH", () => {
    const result = spawnSync("sh", [join(process.cwd(), "docker/start-terminal-services.sh")], {
      env: {
        ...process.env,
        WPDEV_TERMINAL_AUTH: "wpdev:wpdev",
        WPDEV_TERMINAL_WORKDIR: tempDir,
      },
      timeout: 5000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr.toString()).toContain("non-default user:password");
  });

  it("rejects empty WPDEV_TERMINAL_AUTH", () => {
    const result = spawnSync("sh", [join(process.cwd(), "docker/start-terminal-services.sh")], {
      env: {
        ...process.env,
        WPDEV_TERMINAL_AUTH: "",
        WPDEV_TERMINAL_WORKDIR: tempDir,
      },
      timeout: 5000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr.toString()).toContain("non-default user:password");
  });

  it("rejects change-me-user:change-me-password default", () => {
    const result = spawnSync("sh", [join(process.cwd(), "docker/start-terminal-services.sh")], {
      env: {
        ...process.env,
        WPDEV_TERMINAL_AUTH: "change-me-user:change-me-password",
        WPDEV_TERMINAL_WORKDIR: tempDir,
      },
      timeout: 5000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr.toString()).toContain("non-default user:password");
  });

  it("runs node runners in background with correct script paths", () => {
    const nodeLog = join(stubLogDir, "node-calls.log");
    createStub("node", `#!/bin/sh
echo "$@" >> "${nodeLog}"
# Exit immediately - we're just capturing the call
`);

    createStub("runuser", `#!/bin/sh
# Capture env and command, then exit
echo "runuser: $@" >> "${nodeLog}"
echo "WPDEV_TERMINAL_AUTH in env: \${WPDEV_TERMINAL_AUTH:-unset}" >> "${nodeLog}"
exit 0
`);

    createStub("ttyd", `#!/bin/sh
echo "ttyd: $@" >> "${nodeLog}"
exit 0
`);

    createStub("chown", `#!/bin/sh
exit 0
`);

    createStub("chmod", `#!/bin/sh
exit 0
`);

    createStub("groupmod", `#!/bin/sh
exit 0
`);

    createStub("groupadd", `#!/bin/sh
exit 0
`);

    createStub("usermod", `#!/bin/sh
exit 0
`);

    createStub("getent", `#!/bin/sh
exit 1
`);

    const result = spawnSync("sh", [join(process.cwd(), "docker/start-terminal-services.sh")], {
      env: {
        PATH: `${stubBinDir}:${process.env.PATH}`,
        WPDEV_TERMINAL_AUTH: "testuser:testpass",
        WPDEV_TERMINAL_WORKDIR: tempDir,
        WPDEV_HOST_UID: "1001",
        WPDEV_HOST_GID: "1001",
      },
      timeout: 5000,
    });

    const log = readFileSync(nodeLog, "utf8");
    expect(log).toContain("/workspace/docker/terminal-runner.mjs");
    expect(log).toContain("/workspace/docker/host-runner.mjs");
  });

  it("uses env -u to strip WPDEV_TERMINAL_AUTH from ttyd environment", () => {
    const script = readFileSync(join(process.cwd(), "docker/start-terminal-services.sh"), "utf8");
    expect(script).toContain("env -u WPDEV_TERMINAL_AUTH");
    expect(script).toMatch(/exec runuser.*env -u WPDEV_TERMINAL_AUTH.*ttyd/);
  });

  it("uses -d 3 to suppress ttyd startup banner", () => {
    const script = readFileSync(join(process.cwd(), "docker/start-terminal-services.sh"), "utf8");
    expect(script).toContain("ttyd -d 3");
  });

  // G09 FIX: Credential must not appear in any process's argv
  describe("G09 - credential not in argv", () => {
    it("does NOT pass -c to ttyd (credential not on command line)", () => {
      const script = readFileSync(join(process.cwd(), "docker/start-terminal-services.sh"), "utf8");
      // The ttyd command line must NOT contain -c user:pass or --credential as an actual flag
      // Note: bash -lc is fine, we're looking for ttyd's -c flag specifically
      // Note: --credential in comments is fine, we're looking for actual command line usage
      const execLine = script.split("\n").find((l) => l.trimStart().startsWith("exec"));
      expect(execLine).toBeDefined();
      // The exec line should not have -c followed by credential
      expect(execLine).not.toMatch(/ttyd[^#]*\s-c\s+["'$]/);
      expect(execLine).not.toMatch(/ttyd[^#]*--credential\s/);
    });

    it("uses -H/--auth-header for reverse proxy auth instead of -c", () => {
      const script = readFileSync(join(process.cwd(), "docker/start-terminal-services.sh"), "utf8");
      // ttyd should use -H X-WPDEV-Auth for auth header mode
      expect(script).toMatch(/ttyd.*-H\s+X-WPDEV-Auth/);
    });

    it("binds ttyd to container-internal loopback only", () => {
      const script = readFileSync(join(process.cwd(), "docker/start-terminal-services.sh"), "utf8");
      // ttyd should bind to 127.0.0.1 (internal) not 0.0.0.0
      expect(script).toMatch(/ttyd.*-i\s+127\.0\.0\.1/);
    });

    it("starts the auth proxy before ttyd", () => {
      const script = readFileSync(join(process.cwd(), "docker/start-terminal-services.sh"), "utf8");
      // Auth proxy should be started
      expect(script).toContain("ttyd-auth-proxy.mjs");
    });

    it("documents G09 FIX in script comments", () => {
      const script = readFileSync(join(process.cwd(), "docker/start-terminal-services.sh"), "utf8");
      // Must document the architecture for future maintainers
      expect(script).toContain("G09 FIX");
      expect(script).toContain("credential must not appear");
    });

    it("ttyd command line does not contain credential value", () => {
      const script = readFileSync(join(process.cwd(), "docker/start-terminal-services.sh"), "utf8");
      // The exec line should not pass $AUTH as a ttyd argument
      // Note: "env -u WPDEV_TERMINAL_AUTH" is fine - that's stripping it from the env
      const execLine = script.split("\n").find((l) => l.startsWith("exec runuser"));
      expect(execLine).toBeDefined();
      // Must not pass the credential as a ttyd argument
      expect(execLine).not.toMatch(/ttyd.*\$AUTH/);
      expect(execLine).not.toMatch(/ttyd.*\$\{?WPDEV_TERMINAL_AUTH\}?[^=]/);
    });
  });
});

describe("ttyd-auth-proxy.mjs", () => {
  it("exists and uses constant-time comparison for credentials", () => {
    const proxy = readFileSync(join(process.cwd(), "docker/ttyd-auth-proxy.mjs"), "utf8");
    expect(proxy).toContain("timingSafeEqual");
  });

  it("validates Origin header", () => {
    const proxy = readFileSync(join(process.cwd(), "docker/ttyd-auth-proxy.mjs"), "utf8");
    expect(proxy).toContain("validateOrigin");
  });

  it("strips client-supplied auth header before forwarding", () => {
    const proxy = readFileSync(join(process.cwd(), "docker/ttyd-auth-proxy.mjs"), "utf8");
    // Must delete any client-supplied X-WPDEV-Auth header
    expect(proxy).toMatch(/delete.*headers.*TTYD_AUTH_HEADER/i);
  });

  it("handles WebSocket upgrades", () => {
    const proxy = readFileSync(join(process.cwd(), "docker/ttyd-auth-proxy.mjs"), "utf8");
    expect(proxy).toContain("forwardWebSocketUpgrade");
    expect(proxy).toContain("on(\"upgrade\"");
  });

  it("returns 401 for missing or invalid credentials", () => {
    const proxy = readFileSync(join(process.cwd(), "docker/ttyd-auth-proxy.mjs"), "utf8");
    expect(proxy).toContain("send401");
    expect(proxy).toContain("401");
    expect(proxy).toContain("WWW-Authenticate");
  });

  it("returns 403 for invalid Origin", () => {
    const proxy = readFileSync(join(process.cwd(), "docker/ttyd-auth-proxy.mjs"), "utf8");
    expect(proxy).toContain("send403");
    expect(proxy).toContain("Origin not allowed");
  });

  it("does not expose WPDEV_TERMINAL_AUTH in process.argv", () => {
    // The proxy reads from environment, not command line args
    const proxy = readFileSync(join(process.cwd(), "docker/ttyd-auth-proxy.mjs"), "utf8");
    expect(proxy).toContain("process.env.WPDEV_TERMINAL_AUTH");
    expect(proxy).not.toContain("process.argv");
  });
});

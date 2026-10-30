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

  it("passes -c to ttyd for basic auth (G09 DISPUTED: credential visible in ps)", () => {
    const script = readFileSync(join(process.cwd(), "docker/start-terminal-services.sh"), "utf8");
    // G09 DISPUTED: ttyd 1.7.7 only supports -c username:password, not credential files.
    // The credential is visible in `ps aux`. Mitigations documented in the script.
    // See: https://github.com/tsl0922/ttyd/issues/1190
    expect(script).toMatch(/ttyd.*-c "\$AUTH"/);
  });

  it("documents G09 known limitation in script comments", () => {
    const script = readFileSync(join(process.cwd(), "docker/start-terminal-services.sh"), "utf8");
    // Must document the known limitation for future maintainers
    expect(script).toContain("KNOWN LIMITATION (G09)");
    expect(script).toContain("ttyd does not support reading credentials from a file");
  });

  it("uses -d 3 to suppress ttyd startup banner", () => {
    const script = readFileSync(join(process.cwd(), "docker/start-terminal-services.sh"), "utf8");
    expect(script).toContain("ttyd -d 3");
  });
});

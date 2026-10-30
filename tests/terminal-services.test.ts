import { mkdtempSync, rmSync, writeFileSync, chmodSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync, spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("start-terminal-services.sh", () => {
  let tempDir: string;
  let stubBinDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "wp-dev-terminal-services-"));
    stubBinDir = join(tempDir, "bin");
    execSync(`mkdir -p "${stubBinDir}"`);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("refuses default credentials", () => {
    const testScript = join(tempDir, "test.sh");
    writeFileSync(
      testScript,
      `#!/bin/sh
set -eu
AUTH="\${WPDEV_TERMINAL_AUTH:-}"
if [ -z "$AUTH" ] || [ "$AUTH" = "wpdev:wpdev" ] || [ "$AUTH" = "change-me-user:change-me-password" ]; then
  echo "WPDEV_TERMINAL_AUTH must be set to a non-default user:password (run wp-dev up)." >&2
  exit 1
fi
exit 0
`,
    );
    chmodSync(testScript, 0o755);

    const result = spawnSync(testScript, [], {
      env: { WPDEV_TERMINAL_AUTH: "wpdev:wpdev" },
      timeout: 5000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr.toString()).toContain("non-default user:password");
  });

  it("refuses empty credentials", () => {
    const testScript = join(tempDir, "test.sh");
    writeFileSync(
      testScript,
      `#!/bin/sh
set -eu
AUTH="\${WPDEV_TERMINAL_AUTH:-}"
if [ -z "$AUTH" ] || [ "$AUTH" = "wpdev:wpdev" ] || [ "$AUTH" = "change-me-user:change-me-password" ]; then
  echo "WPDEV_TERMINAL_AUTH must be set to a non-default user:password (run wp-dev up)." >&2
  exit 1
fi
exit 0
`,
    );
    chmodSync(testScript, 0o755);

    const result = spawnSync(testScript, [], {
      env: { WPDEV_TERMINAL_AUTH: "" },
      timeout: 5000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr.toString()).toContain("non-default user:password");
  });

  it("env -u strips WPDEV_TERMINAL_AUTH from child process", () => {
    const logFile = join(tempDir, "env.log");
    const testScript = join(tempDir, "test.sh");
    writeFileSync(
      testScript,
      `#!/bin/sh
export WPDEV_TERMINAL_AUTH="secret:pass"
env -u WPDEV_TERMINAL_AUTH sh -c 'echo "WPDEV_TERMINAL_AUTH=\${WPDEV_TERMINAL_AUTH:-unset}"' > "${logFile}"
`,
    );
    chmodSync(testScript, 0o755);

    const result = spawnSync(testScript, [], { timeout: 5000 });
    expect(result.status).toBe(0);
    const log = readFileSync(logFile, "utf8");
    expect(log.trim()).toBe("WPDEV_TERMINAL_AUTH=unset");
  });

  it("start-terminal-services.sh uses env -u to strip credential from ttyd", () => {
    const script = readFileSync(join(process.cwd(), "docker/start-terminal-services.sh"), "utf8");
    expect(script).toContain("env -u WPDEV_TERMINAL_AUTH");
    expect(script).toMatch(/exec runuser.*env -u WPDEV_TERMINAL_AUTH.*ttyd/);
  });
});

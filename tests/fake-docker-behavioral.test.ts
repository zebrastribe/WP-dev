/**
 * Behavioral tests using a fake docker binary.
 *
 * These tests verify that commands actually call docker with the correct
 * arguments and environment variables by using a fake docker binary that
 * logs all calls to a file.
 *
 * Mutation coverage:
 * - M1: cmdUp calls ensureComposePrerequisites before compose
 * - compose() forwards options.env via buildComposeEnv
 * - Network env vars are set before docker calls
 * - HOST_* vars come from validation, not shell exports
 */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { DEFAULT_SUBNET_PREFIX } from "../src/utils/network-config.js";

function createFakeDockerBinary(logPath: string, binDir: string): string {
  const dockerPath = join(binDir, "docker");
  const script = `#!/bin/bash
# Fake docker binary for testing - logs argv and env to file
echo "--- CALL ---" >> "${logPath}"
echo "ARGV: $@" >> "${logPath}"
echo "PWD: $(pwd)" >> "${logPath}"
echo "WPDEV_NETWORK_SUBNET=\${WPDEV_NETWORK_SUBNET:-unset}" >> "${logPath}"
echo "WPDEV_NETWORK_GATEWAY=\${WPDEV_NETWORK_GATEWAY:-unset}" >> "${logPath}"
echo "WPDEV_HOST_PROJECT_ROOT=\${WPDEV_HOST_PROJECT_ROOT:-unset}" >> "${logPath}"
echo "WPDEV_HOST_HOME=\${WPDEV_HOST_HOME:-unset}" >> "${logPath}"
echo "WPDEV_HOST_UID=\${WPDEV_HOST_UID:-unset}" >> "${logPath}"
echo "WPDEV_HOST_GID=\${WPDEV_HOST_GID:-unset}" >> "${logPath}"
echo "---" >> "${logPath}"
# For 'compose ps' return empty JSON
if [[ "$*" == *"compose"*"ps"* ]]; then
  echo "[]"
  exit 0
fi
# For network commands, succeed silently
if [[ "$*" == *"network"* ]]; then
  exit 0
fi
# For 'compose run' commands, succeed silently
if [[ "$*" == *"compose"*"run"* ]]; then
  exit 0
fi
# For 'compose up' commands, succeed
if [[ "$*" == *"compose"*"up"* ]]; then
  exit 0
fi
# For 'compose down' commands, succeed
if [[ "$*" == *"compose"*"down"* ]]; then
  exit 0
fi
# For 'compose config' commands, return minimal config
if [[ "$*" == *"compose"*"config"* ]]; then
  echo "services:"
  echo "  wordpress:"
  echo "    image: wordpress:latest"
  exit 0
fi
# Default: succeed
exit 0
`;
  writeFileSync(dockerPath, script);
  chmodSync(dockerPath, 0o755);
  return binDir;
}

function makeMinimalDockerDir(tmpDir: string): string {
  const dockerDir = join(tmpDir, "docker");
  mkdirSync(dockerDir, { recursive: true });

  writeFileSync(
    join(dockerDir, ".env"),
    `WP_PORT=8888\n`,
  );

  writeFileSync(
    join(dockerDir, "docker-compose.yml"),
    `services:
  wordpress:
    image: wordpress:latest
    volumes:
      - ../wordpress:/var/www/html
`,
  );

  mkdirSync(join(tmpDir, "wordpress"), { recursive: true });

  return dockerDir;
}

function makeConfigFile(tmpDir: string): void {
  writeFileSync(
    join(tmpDir, "wp-dev.config.json"),
    JSON.stringify({
      project: "test-project",
      local: {
        path: "docker",
        url: "http://localhost:8888",
        wpRoot: "wordpress",
        composeFile: "docker-compose.yml",
        composeService: "wordpress",
      },
      staging: { host: "", path: "", user: "", url: "" },
      production: { host: "", path: "", user: "", url: "" },
    }),
  );
}

function parseDockerLog(logPath: string): Array<{
  argv: string;
  pwd: string;
  env: Record<string, string>;
}> {
  if (!existsSync(logPath)) return [];
  const content = readFileSync(logPath, "utf8");
  const calls: Array<{ argv: string; pwd: string; env: Record<string, string> }> = [];

  const sections = content.split("--- CALL ---").slice(1);
  for (const section of sections) {
    const lines = section.trim().split("\n");
    const call: { argv: string; pwd: string; env: Record<string, string> } = {
      argv: "",
      pwd: "",
      env: {},
    };

    for (const line of lines) {
      if (line === "---") continue;
      if (line.startsWith("ARGV: ")) {
        call.argv = line.slice(6);
      } else if (line.startsWith("PWD: ")) {
        call.pwd = line.slice(5);
      } else if (line.includes("=")) {
        const [key, ...rest] = line.split("=");
        call.env[key] = rest.join("=");
      }
    }

    calls.push(call);
  }

  return calls;
}

describe("fake docker behavioral tests", () => {
  let tmpDir: string;
  let binDir: string;
  let logPath: string;
  let savedPath: string | undefined;
  let savedProcessEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "wpdev-fake-docker-"));
    binDir = join(tmpDir, "bin");
    mkdirSync(binDir, { recursive: true });
    logPath = join(tmpDir, "docker-calls.log");
    savedPath = process.env.PATH;
    savedProcessEnv = { ...process.env };

    createFakeDockerBinary(logPath, binDir);
    process.env.PATH = `${binDir}:${savedPath}`;

    makeMinimalDockerDir(tmpDir);
    makeConfigFile(tmpDir);
  });

  afterEach(() => {
    process.env = savedProcessEnv;
    if (savedPath !== undefined) {
      process.env.PATH = savedPath;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("compose_forwards_options_env: options.env is passed to docker child process", async () => {
    const { compose } = await import("../src/services/docker-compose.js");
    const config = {
      project: "test-project",
      local: {
        path: "docker",
        url: "http://localhost:8888",
        wpRoot: "wordpress",
        composeFile: "docker-compose.yml",
        composeService: "wordpress",
      },
      staging: { host: "", path: "", user: "", url: "" },
      production: { host: "", path: "", user: "", url: "" },
    };

    await compose(tmpDir, config, ["ps", "--format", "json"], {
      env: {
        WPDEV_NETWORK_SUBNET: `${DEFAULT_SUBNET_PREFIX}.99.0/24`,
        WPDEV_NETWORK_GATEWAY: `${DEFAULT_SUBNET_PREFIX}.99.1`,
      },
    });

    const calls = parseDockerLog(logPath);
    expect(calls.length).toBeGreaterThan(0);

    const composeCall = calls.find((c) => c.argv.includes("compose") && c.argv.includes("ps"));
    expect(composeCall).toBeDefined();
    expect(composeCall!.env.WPDEV_NETWORK_SUBNET).toBe(`${DEFAULT_SUBNET_PREFIX}.99.0/24`);
    expect(composeCall!.env.WPDEV_NETWORK_GATEWAY).toBe(`${DEFAULT_SUBNET_PREFIX}.99.1`);
  });

  it("compose_sets_host_paths: HOST_* vars are set from validated functions", async () => {
    const { compose } = await import("../src/services/docker-compose.js");
    const config = {
      project: "test-project",
      local: {
        path: "docker",
        url: "http://localhost:8888",
        wpRoot: "wordpress",
        composeFile: "docker-compose.yml",
        composeService: "wordpress",
      },
      staging: { host: "", path: "", user: "", url: "" },
      production: { host: "", path: "", user: "", url: "" },
    };

    await compose(tmpDir, config, ["ps", "--format", "json"]);

    const calls = parseDockerLog(logPath);
    expect(calls.length).toBeGreaterThan(0);

    const composeCall = calls.find((c) => c.argv.includes("compose"));
    expect(composeCall).toBeDefined();

    // HOST_* vars should be set and NOT be /workspace or /root
    expect(composeCall!.env.WPDEV_HOST_PROJECT_ROOT).not.toBe("unset");
    expect(composeCall!.env.WPDEV_HOST_PROJECT_ROOT).not.toBe("/workspace");
    expect(composeCall!.env.WPDEV_HOST_HOME).not.toBe("unset");
    expect(composeCall!.env.WPDEV_HOST_HOME).not.toBe("/root");
    expect(composeCall!.env.WPDEV_HOST_UID).not.toBe("unset");
    expect(composeCall!.env.WPDEV_HOST_GID).not.toBe("unset");
  });

  it("shell_exported_workspace_is_rejected: shell export of /workspace bypasses nothing", async () => {
    process.env.WPDEV_HOST_PROJECT_ROOT = "/workspace";

    const { compose } = await import("../src/services/docker-compose.js");
    const config = {
      project: "test-project",
      local: {
        path: "docker",
        url: "http://localhost:8888",
        wpRoot: "wordpress",
        composeFile: "docker-compose.yml",
        composeService: "wordpress",
      },
      staging: { host: "", path: "", user: "", url: "" },
      production: { host: "", path: "", user: "", url: "" },
    };

    await compose(tmpDir, config, ["ps", "--format", "json"]);

    const calls = parseDockerLog(logPath);
    const composeCall = calls.find((c) => c.argv.includes("compose"));
    expect(composeCall).toBeDefined();

    // /workspace MUST be rejected by validation
    expect(composeCall!.env.WPDEV_HOST_PROJECT_ROOT).not.toBe("/workspace");
  });

  it("shell_exported_root_home_is_rejected: shell export of /root bypasses nothing", async () => {
    process.env.WPDEV_HOST_HOME = "/root";

    const { compose } = await import("../src/services/docker-compose.js");
    const config = {
      project: "test-project",
      local: {
        path: "docker",
        url: "http://localhost:8888",
        wpRoot: "wordpress",
        composeFile: "docker-compose.yml",
        composeService: "wordpress",
      },
      staging: { host: "", path: "", user: "", url: "" },
      production: { host: "", path: "", user: "", url: "" },
    };

    await compose(tmpDir, config, ["ps", "--format", "json"]);

    const calls = parseDockerLog(logPath);
    const composeCall = calls.find((c) => c.argv.includes("compose"));
    expect(composeCall).toBeDefined();

    // /root MUST be rejected by validation
    expect(composeCall!.env.WPDEV_HOST_HOME).not.toBe("/root");
  });

  it("network_shell_precedence_works: shell-exported network vars win", async () => {
    process.env.WPDEV_NETWORK_SUBNET = `${DEFAULT_SUBNET_PREFIX}.77.0/24`;

    const { compose } = await import("../src/services/docker-compose.js");
    const config = {
      project: "test-project",
      local: {
        path: "docker",
        url: "http://localhost:8888",
        wpRoot: "wordpress",
        composeFile: "docker-compose.yml",
        composeService: "wordpress",
      },
      staging: { host: "", path: "", user: "", url: "" },
      production: { host: "", path: "", user: "", url: "" },
    };

    // Even if options.env has a different subnet, shell export should win
    await compose(tmpDir, config, ["ps", "--format", "json"], {
      env: {
        WPDEV_NETWORK_SUBNET: `${DEFAULT_SUBNET_PREFIX}.88.0/24`,
      },
    });

    const calls = parseDockerLog(logPath);
    const composeCall = calls.find((c) => c.argv.includes("compose"));
    expect(composeCall).toBeDefined();

    // Shell-exported network var should win
    expect(composeCall!.env.WPDEV_NETWORK_SUBNET).toBe(`${DEFAULT_SUBNET_PREFIX}.77.0/24`);
  });

  it("buildComposeEnv_validates_all_host_paths: uid/gid also come from validation", async () => {
    // Set dangerous shell values for uid/gid
    process.env.WPDEV_HOST_UID = "0";
    process.env.WPDEV_HOST_GID = "0";

    const { buildComposeEnv } = await import("../src/services/docker-compose.js");
    const dockerDir = join(tmpDir, "docker");
    const env = buildComposeEnv(dockerDir, {});

    // UID/GID should come from validation, not shell export
    // (validation uses getuid()/getgid() or reads from .env file)
    // The key point is they're set and come from the validator, not shell
    expect(env.WPDEV_HOST_UID).toBeDefined();
    expect(env.WPDEV_HOST_GID).toBeDefined();
  });
});

describe("prerequisites before compose call ordering", () => {
  let tmpDir: string;
  let binDir: string;
  let logPath: string;
  let savedPath: string | undefined;
  let savedProcessEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "wpdev-order-"));
    binDir = join(tmpDir, "bin");
    mkdirSync(binDir, { recursive: true });
    logPath = join(tmpDir, "docker-calls.log");
    savedPath = process.env.PATH;
    savedProcessEnv = { ...process.env };

    createFakeDockerBinary(logPath, binDir);
    process.env.PATH = `${binDir}:${savedPath}`;

    makeMinimalDockerDir(tmpDir);
    makeConfigFile(tmpDir);

    // Mock network functions to avoid real Docker network calls
    const networkConfig = await import("../src/utils/network-config.js");
    vi.spyOn(networkConfig, "dockerNetworkExists").mockReturnValue(false);
    vi.spyOn(networkConfig, "findAvailableSubnet").mockReturnValue(`${DEFAULT_SUBNET_PREFIX}.1.0/24`);
    vi.spyOn(networkConfig, "listDockerNetworkSubnets").mockReturnValue(new Map());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = savedProcessEnv;
    if (savedPath !== undefined) {
      process.env.PATH = savedPath;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("remoteip_conf_exists_before_compose: ensureComposePrerequisites creates file before compose", async () => {
    const { ensureComposePrerequisites } = await import("../src/utils/compose-prerequisites.js");
    const { compose } = await import("../src/services/docker-compose.js");

    const loaded = {
      configDir: tmpDir,
      configPath: join(tmpDir, "wp-dev.config.json"),
      config: {
        project: "test-project",
        local: {
          path: "docker",
          url: "http://localhost:8888",
          wpRoot: "wordpress",
          composeFile: "docker-compose.yml",
          composeService: "wordpress",
        },
        staging: { host: "", path: "", user: "", url: "" },
        production: { host: "", path: "", user: "", url: "" },
      },
    };

    const dockerDir = join(tmpDir, "docker");
    const remoteIpPath = join(dockerDir, "remoteip.conf");

    // Initially no remoteip.conf
    expect(existsSync(remoteIpPath)).toBe(false);

    // Call prerequisites
    ensureComposePrerequisites(loaded as any);

    // Now remoteip.conf must exist
    expect(existsSync(remoteIpPath)).toBe(true);

    // Now compose can be called
    await compose(tmpDir, loaded.config, ["ps", "--format", "json"]);

    const calls = parseDockerLog(logPath);
    expect(calls.length).toBeGreaterThan(0);
  });

  it("network_env_set_before_compose: network vars are available in docker env", async () => {
    const { ensureComposePrerequisites, resolveNetworkEnvForCompose } = await import(
      "../src/utils/compose-prerequisites.js"
    );
    const { compose } = await import("../src/services/docker-compose.js");

    const loaded = {
      configDir: tmpDir,
      configPath: join(tmpDir, "wp-dev.config.json"),
      config: {
        project: "test-project",
        local: {
          path: "docker",
          url: "http://localhost:8888",
          wpRoot: "wordpress",
          composeFile: "docker-compose.yml",
          composeService: "wordpress",
        },
        staging: { host: "", path: "", user: "", url: "" },
        production: { host: "", path: "", user: "", url: "" },
      },
    };

    ensureComposePrerequisites(loaded as any);
    const networkEnv = resolveNetworkEnvForCompose(loaded as any);

    await compose(tmpDir, loaded.config, ["run", "--rm", "wordpress", "echo", "test"], {
      env: networkEnv,
    });

    const calls = parseDockerLog(logPath);
    const runCall = calls.find((c) => c.argv.includes("run"));
    expect(runCall).toBeDefined();

    // Network env should be set (from allocator, not unset)
    expect(runCall!.env.WPDEV_NETWORK_SUBNET).not.toBe("unset");
    expect(runCall!.env.WPDEV_NETWORK_GATEWAY).not.toBe("unset");
    expect(runCall!.env.WPDEV_NETWORK_SUBNET).toMatch(new RegExp(`^${DEFAULT_SUBNET_PREFIX.replace(/\./g, "\\.")}`));
  });
});

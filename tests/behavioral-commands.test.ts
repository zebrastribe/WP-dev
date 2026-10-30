/**
 * Behavioral tests for wp-dev commands with fake docker binary.
 * These tests verify actual command behavior by recording docker invocations.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  symlinkSync,
  lstatSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LoadedConfig } from "../src/config/load.js";
import { DEFAULT_DOCKER_ENV_PORTS, DEFAULT_LOCAL_HOST, listSecurityEnvPlaceholderKeys } from "../src/utils/compose-env.js";
import { DEFAULT_SUBNET_PREFIX } from "../src/utils/network-config.js";

function makeLoadedConfig(configDir: string, localPath = "docker"): LoadedConfig {
  return {
    configDir,
    configPath: join(configDir, "wp-dev.config.json"),
    config: {
      project: "test-project",
      local: {
        path: localPath,
        url: "http://localhost:8888",
        wpRoot: "wordpress",
      },
      staging: { host: "", path: "", user: "", url: "" },
      production: { host: "", path: "", user: "", url: "" },
    },
  } as LoadedConfig;
}

describe("behavioral tests - status command", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "wpdev-status-test-"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("status works with old .env files missing WPDEV_NETWORK_SUBNET", async () => {
    const dockerDir = join(tmpDir, "docker");
    mkdirSync(dockerDir, { recursive: true });
    // Old .env without network vars
    writeFileSync(join(dockerDir, ".env"), "WP_PORT=8888\n");
    writeFileSync(join(tmpDir, "wp-dev.config.json"), "{}");

    const loaded = makeLoadedConfig(tmpDir);

    // Mock compose operations
    const dockerCompose = await import("../src/services/docker-compose.js");
    vi.spyOn(dockerCompose, "composeRead").mockImplementation(async (loaded, args, networkEnv) => {
      // Verify network env was passed
      expect(networkEnv.WPDEV_NETWORK_SUBNET).toBeTruthy();
      expect(networkEnv.WPDEV_NETWORK_GATEWAY).toBeTruthy();
      return { stdout: "", stderr: "", exitCode: 1 }; // Stack not running
    });

    // Run status command - should NOT throw about missing WPDEV_NETWORK_SUBNET
    const { cmdStatus } = await import("../src/commands/status.js");
    await expect(cmdStatus(loaded)).resolves.not.toThrow();
  });

  it("resolveNetworkEnvForCompose provides network vars for old .env files", async () => {
    const dockerDir = join(tmpDir, "docker");
    mkdirSync(dockerDir, { recursive: true });
    // Old .env without network vars
    writeFileSync(join(dockerDir, ".env"), "WP_PORT=8888\n");

    const loaded = makeLoadedConfig(tmpDir);
    const { resolveNetworkEnvForCompose } = await import("../src/utils/compose-prerequisites.js");

    const networkEnv = resolveNetworkEnvForCompose(loaded);

    // Should derive network vars without throwing
    expect(networkEnv.WPDEV_NETWORK_SUBNET).toBeTruthy();
    expect(networkEnv.WPDEV_NETWORK_GATEWAY).toBeTruthy();
    expect(networkEnv.WPDEV_NETWORK_SUBNET).toMatch(/^\d+\.\d+\.\d+\.\d+\/\d+$/);
  });
});

describe("behavioral tests - shell precedence", () => {
  let tmpDir: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "wpdev-precedence-test-"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("shell-exported WPDEV_NETWORK_SUBNET wins over injected default", async () => {
    const dockerDir = join(tmpDir, "docker");
    mkdirSync(dockerDir, { recursive: true });
    writeFileSync(join(dockerDir, ".env"), "WP_PORT=8888\n");

    // Simulate shell export
    process.env.WPDEV_NETWORK_SUBNET = "10.50.0.0/24";
    process.env.WPDEV_NETWORK_GATEWAY = "10.50.0.1";

    const { buildComposeEnv } = await import("../src/services/docker-compose.js");

    const injectedEnv = {
      WPDEV_NETWORK_SUBNET: "172.28.1.0/24",
      WPDEV_NETWORK_GATEWAY: "172.28.1.1",
    };

    const env = buildComposeEnv(dockerDir, { env: injectedEnv });

    // Shell values should win
    expect(env.WPDEV_NETWORK_SUBNET).toBe("10.50.0.0/24");
    expect(env.WPDEV_NETWORK_GATEWAY).toBe("10.50.0.1");
  });

  it("injected values are used when shell has no override", async () => {
    const dockerDir = join(tmpDir, "docker");
    mkdirSync(dockerDir, { recursive: true });

    // Clear any existing env vars
    delete process.env.WPDEV_NETWORK_SUBNET;
    delete process.env.WPDEV_NETWORK_GATEWAY;

    const { buildComposeEnv } = await import("../src/services/docker-compose.js");

    const injectedEnv = {
      WPDEV_NETWORK_SUBNET: "172.28.1.0/24",
      WPDEV_NETWORK_GATEWAY: "172.28.1.1",
    };

    const env = buildComposeEnv(dockerDir, { env: injectedEnv });

    // Injected values should be used
    expect(env.WPDEV_NETWORK_SUBNET).toBe("172.28.1.0/24");
    expect(env.WPDEV_NETWORK_GATEWAY).toBe("172.28.1.1");
  });
});

describe("behavioral tests - compose env forwarding", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "wpdev-compose-env-test-"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("buildComposeEnv includes env option values in output", async () => {
    const dockerDir = join(tmpDir, "docker");
    mkdirSync(dockerDir, { recursive: true });
    writeFileSync(join(dockerDir, ".env"), "WP_PORT=8888\n");

    const { buildComposeEnv } = await import("../src/services/docker-compose.js");

    const env = buildComposeEnv(dockerDir, {
      env: {
        WPDEV_NETWORK_SUBNET: "172.28.5.0/24",
        CUSTOM_VAR: "custom-value",
      },
    });

    // Env option values should be included
    expect(env.WPDEV_NETWORK_SUBNET).toBe("172.28.5.0/24");
    expect(env.CUSTOM_VAR).toBe("custom-value");
  });

  it("buildComposeEnv adds host path defaults", async () => {
    const dockerDir = join(tmpDir, "docker");
    mkdirSync(dockerDir, { recursive: true });

    const { buildComposeEnv } = await import("../src/services/docker-compose.js");

    const env = buildComposeEnv(dockerDir, {});

    // Host path defaults should be set
    expect(env.WPDEV_HOST_PROJECT_ROOT).toBeTruthy();
    expect(env.WPDEV_HOST_HOME).toBeTruthy();
    expect(env.WPDEV_HOST_UID).toBeTruthy();
    expect(env.WPDEV_HOST_GID).toBeTruthy();
  });
});

describe("behavioral tests - placeholder detection", () => {
  it("detects placeholder with localhost", () => {
    const content = `WPDEV_TERMINAL_RUNNER_ORIGIN=http://localhost:${DEFAULT_DOCKER_ENV_PORTS.WP_PORT}`;
    const placeholders = listSecurityEnvPlaceholderKeys(content);
    expect(placeholders).toContain("WPDEV_TERMINAL_RUNNER_ORIGIN");
  });

  it("detects placeholder with 127.0.0.1", () => {
    const content = `WPDEV_TERMINAL_RUNNER_ORIGIN=http://127.0.0.1:${DEFAULT_DOCKER_ENV_PORTS.WP_PORT}`;
    const placeholders = listSecurityEnvPlaceholderKeys(content);
    expect(placeholders).toContain("WPDEV_TERMINAL_RUNNER_ORIGIN");
  });

  it("detects placeholder with DEFAULT_LOCAL_HOST", () => {
    const content = `WPDEV_TERMINAL_RUNNER_ORIGIN=http://${DEFAULT_LOCAL_HOST}:${DEFAULT_DOCKER_ENV_PORTS.WP_PORT}`;
    const placeholders = listSecurityEnvPlaceholderKeys(content);
    expect(placeholders).toContain("WPDEV_TERMINAL_RUNNER_ORIGIN");
  });

  it("does not flag non-default port as placeholder", () => {
    const content = `WPDEV_TERMINAL_RUNNER_ORIGIN=http://localhost:9999`;
    const placeholders = listSecurityEnvPlaceholderKeys(content);
    expect(placeholders).not.toContain("WPDEV_TERMINAL_RUNNER_ORIGIN");
  });

  it("does not flag custom host as placeholder", () => {
    const content = `WPDEV_TERMINAL_RUNNER_ORIGIN=http://mysite.local:${DEFAULT_DOCKER_ENV_PORTS.WP_PORT}`;
    const placeholders = listSecurityEnvPlaceholderKeys(content);
    expect(placeholders).not.toContain("WPDEV_TERMINAL_RUNNER_ORIGIN");
  });
});

describe("behavioral tests - symlink error messages", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "wpdev-symlink-msg-test-"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("symlinked .env error message instructs copying, not regenerating", async () => {
    const dockerDir = join(tmpDir, "docker");
    mkdirSync(dockerDir, { recursive: true });

    // Create target and symlink
    const targetPath = join(tmpDir, "real.env");
    writeFileSync(targetPath, "WP_PORT=9999\nWPDEV_ADMIN_SAVE_TOKEN=my-secret-token\n");
    const linkPath = join(dockerDir, ".env");
    symlinkSync(targetPath, linkPath);

    const { writeEnvFile } = await import("../src/utils/compose-env.js");

    let errorMessage = "";
    try {
      writeEnvFile(linkPath, "NEW_CONTENT=test\n");
    } catch (e) {
      errorMessage = (e as Error).message;
    }

    // Error should instruct copying to preserve tokens, not regenerating
    expect(errorMessage).toContain("symlink");
    expect(errorMessage).toContain("preserve your tokens");
    expect(errorMessage).toContain("cp"); // Contains cp command
    expect(errorMessage).not.toContain("regenerate");
    expect(errorMessage).not.toContain("let wp-dev generate");
  });

  it("symlinked remoteip.conf error message is different from .env", async () => {
    const dockerDir = join(tmpDir, "docker");
    mkdirSync(dockerDir, { recursive: true });

    // Create target and symlink
    const targetPath = join(tmpDir, "real-remoteip.conf");
    writeFileSync(targetPath, "# custom config\n");
    const linkPath = join(dockerDir, "remoteip.conf");
    symlinkSync(targetPath, linkPath);

    const { assertNotSymlink } = await import("../src/utils/generated-bind-mounts.js");

    let errorMessage = "";
    try {
      assertNotSymlink(linkPath, "Apache RemoteIP configuration");
    } catch (e) {
      errorMessage = (e as Error).message;
    }

    // Error should mention symlink and removal
    expect(errorMessage).toContain("symlink");
    expect(errorMessage).toContain("remove the symlink");
  });
});

describe("behavioral tests - no localhost literals", () => {
  it("DEFAULT_LOCAL_HOST is defined", async () => {
    const { DEFAULT_LOCAL_HOST } = await import("../src/utils/compose-env.js");
    expect(DEFAULT_LOCAL_HOST).toBe("127.0.0.1");
  });

  it("buildRunnerOrigin fallback uses DEFAULT_LOCAL_HOST", async () => {
    const { buildRunnerOrigin, DEFAULT_LOCAL_HOST, DEFAULT_DOCKER_ENV_PORTS } = await import(
      "../src/utils/compose-env.js"
    );

    // Pass malformed URL to trigger fallback
    const result = buildRunnerOrigin("not-a-valid-url");

    expect(result).toContain(DEFAULT_LOCAL_HOST);
    expect(result).toContain(String(DEFAULT_DOCKER_ENV_PORTS.WP_PORT));
  });
});

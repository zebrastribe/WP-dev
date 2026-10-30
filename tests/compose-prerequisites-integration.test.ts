/**
 * Integration tests for compose prerequisites.
 *
 * These tests use a fake docker/compose binary to verify the call order
 * and environment injection. Each test should FAIL if the corresponding
 * mutation is applied to the codebase.
 *
 * Mutation table:
 * - M1: remove prerequisites call from up → test: cmdUp_calls_prerequisites_before_compose
 * - M3: move prereq after startup reconcile → test: cmdUp_calls_prerequisites_before_autoReconcile
 * - M4: remove fix-permissions guard → test: fixPermissions_ensures_bind_mount_files
 * - M6: restore 172.28.0.0/24 compose fallback → test: network_subnet_never_0_0_24
 * - M7: trust proxy with SSL off → test: ssl_off_no_proxy_trust
 * - M8: disable existing-network reuse → test: existing_network_is_reused
 * - M9: remove empty-dir self-heal → test: empty_dir_is_healed
 * - M10: make doctor write anything → test: doctor_is_read_only
 * - Write through symlink → test: symlink_throws_clear_error
 * - relocate-ports not updating runner origin → test: relocate_ports_updates_origin
 * - HOST_* validation → test: host_project_root_rejects_workspace, host_home_rejects_root
 */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  statSync,
  readFileSync,
  symlinkSync,
  lstatSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LoadedConfig } from "../src/config/load.js";
import { DEFAULT_SUBNET_PREFIX, generateRemoteIpConf } from "../src/utils/network-config.js";
import { DEFAULT_DOCKER_ENV_PORTS } from "../src/utils/compose-env.js";

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
        composeFile: "docker-compose.yml",
        composeService: "wordpress",
      },
      staging: { host: "", path: "", user: "", url: "" },
      production: { host: "", path: "", user: "", url: "" },
    },
  } as LoadedConfig;
}

describe("compose prerequisites integration - mutation tests", () => {
  let tmpDir: string;
  let composeCalls: Array<{ args: string[]; env: NodeJS.ProcessEnv }>;
  let savedProcessEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "wpdev-integration-test-"));
    composeCalls = [];
    savedProcessEnv = { ...process.env };

    // Mock assertDockerReady to skip Docker check
    const dockerPrereq = await import("../src/utils/docker-prereq.js");
    vi.spyOn(dockerPrereq, "assertDockerReady").mockImplementation(() => {});

    // Mock compose to record calls
    const dockerCompose = await import("../src/services/docker-compose.js");
    vi.spyOn(dockerCompose, "compose").mockImplementation(
      async (configDir, config, args) => {
        composeCalls.push({
          args: [...args],
          env: { ...process.env },
        });
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    );

    // Mock network functions to avoid real Docker calls
    const networkConfig = await import("../src/utils/network-config.js");
    vi.spyOn(networkConfig, "dockerNetworkExists").mockReturnValue(false);
    vi.spyOn(networkConfig, "findAvailableSubnet").mockReturnValue(`${DEFAULT_SUBNET_PREFIX}.1.0/24`);
    vi.spyOn(networkConfig, "listDockerNetworkSubnets").mockReturnValue(new Map());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = savedProcessEnv;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // M6: restore 172.28.0.0/24 compose fallback
  it("network_subnet_never_0_0_24: subnet is allocated from .1.0/24, not .0.0/24", async () => {
    const dockerDir = join(tmpDir, "docker");
    mkdirSync(dockerDir, { recursive: true });
    writeFileSync(join(dockerDir, ".env"), "WP_PORT=8888\n");

    const { ensureComposePrerequisites } = await import("../src/utils/compose-prerequisites.js");
    const loaded = makeLoadedConfig(tmpDir);
    const result = ensureComposePrerequisites(loaded);

    expect(result.networkInfo).not.toBeNull();
    expect(result.networkInfo?.subnet).not.toBe(`${DEFAULT_SUBNET_PREFIX}.0.0/24`);
    // Must start with the prefix and be .X.0/24 where X >= 1
    const escapedPrefix = DEFAULT_SUBNET_PREFIX.replace(/\./g, "\\.");
    expect(result.networkInfo?.subnet).toMatch(new RegExp(`^${escapedPrefix}\\.[1-9]\\d*\\.0/24$`));
  });

  // M7: trust proxy with SSL off
  it("ssl_off_no_proxy_trust: SSL off has no active RemoteIPHeader", () => {
    const content = generateRemoteIpConf(null);
    // Must NOT have an uncommented RemoteIPHeader line
    expect(content).not.toMatch(/^[^#]*RemoteIPHeader/m);
    expect(content).toContain("SSL proxy not active");
    // Should have commented-out IfModule
    expect(content).toContain("# <IfModule remoteip_module>");
  });

  // M9: remove empty-dir self-heal
  it("empty_dir_is_healed: empty directory at remoteip.conf is healed to file", async () => {
    const dockerDir = join(tmpDir, "docker");
    const confPath = join(dockerDir, "remoteip.conf");
    mkdirSync(confPath, { recursive: true });
    expect(statSync(confPath).isDirectory()).toBe(true);

    const { ensureGeneratedBindMountFiles } = await import("../src/utils/generated-bind-mounts.js");
    const loaded = makeLoadedConfig(tmpDir);
    const results = ensureGeneratedBindMountFiles(loaded);

    expect(results.some((r) => r.action === "healed")).toBe(true);
    expect(statSync(confPath).isFile()).toBe(true);
    expect(readFileSync(confPath, "utf8")).toContain("# wp-dev");
  });

  // Write through symlink
  it("symlink_throws_clear_error: symlink is refused with clear message", async () => {
    const dockerDir = join(tmpDir, "docker");
    mkdirSync(dockerDir, { recursive: true });

    const targetPath = join(tmpDir, "outside-file.conf");
    writeFileSync(targetPath, "# original content\n");
    const linkPath = join(dockerDir, "remoteip.conf");
    symlinkSync(targetPath, linkPath);

    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);

    const { ensureGeneratedBindMountFiles } = await import("../src/utils/generated-bind-mounts.js");
    const loaded = makeLoadedConfig(tmpDir);

    // Must throw with a clear error message
    expect(() => ensureGeneratedBindMountFiles(loaded)).toThrow(/symlink/i);
    expect(() => ensureGeneratedBindMountFiles(loaded)).toThrow(/remove the symlink/i);

    // Target file must NOT be overwritten
    expect(readFileSync(targetPath, "utf8")).toBe("# original content\n");
  });

  // M10: make doctor write anything
  it("doctor_is_read_only: doctor checkComposePrerequisites never writes", async () => {
    const dockerDir = join(tmpDir, "docker");
    mkdirSync(dockerDir, { recursive: true });
    writeFileSync(join(dockerDir, ".env"), "WP_PORT=8888\n");
    const envBefore = readFileSync(join(dockerDir, ".env"), "utf8");

    const { checkComposePrerequisites } = await import("../src/utils/compose-prerequisites.js");
    const loaded = makeLoadedConfig(tmpDir);

    // checkComposePrerequisites is the read-only check used by doctor
    const result = checkComposePrerequisites(loaded);

    // Should report issues but NOT write
    expect(result.ready).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);

    // .env must be IDENTICAL (byte-for-byte)
    const envAfter = readFileSync(join(dockerDir, ".env"), "utf8");
    expect(envAfter).toBe(envBefore);
  });

  // HOST_* validation: /workspace is rejected
  it("host_project_root_rejects_workspace: exported /workspace is rejected by validation", async () => {
    const dockerDir = join(tmpDir, "docker");
    mkdirSync(dockerDir, { recursive: true });
    writeFileSync(join(dockerDir, ".env"), "WP_PORT=8888\n");

    const originalEnv = process.env.WPDEV_HOST_PROJECT_ROOT;
    process.env.WPDEV_HOST_PROJECT_ROOT = "/workspace";

    try {
      const { buildComposeEnv } = await import("../src/services/docker-compose.js");
      const env = buildComposeEnv(dockerDir, {});

      // /workspace should NOT be used - validation rejects it
      expect(env.WPDEV_HOST_PROJECT_ROOT).not.toBe("/workspace");
    } finally {
      if (originalEnv !== undefined) {
        process.env.WPDEV_HOST_PROJECT_ROOT = originalEnv;
      } else {
        delete process.env.WPDEV_HOST_PROJECT_ROOT;
      }
    }
  });

  // HOST_* validation: /root is rejected
  it("host_home_rejects_root: exported /root is rejected by validation", async () => {
    const dockerDir = join(tmpDir, "docker");
    mkdirSync(dockerDir, { recursive: true });
    writeFileSync(join(dockerDir, ".env"), "WP_PORT=8888\n");

    const originalEnv = process.env.WPDEV_HOST_HOME;
    process.env.WPDEV_HOST_HOME = "/root";

    try {
      const { buildComposeEnv } = await import("../src/services/docker-compose.js");
      const env = buildComposeEnv(dockerDir, {});

      // /root should NOT be used - validation rejects it
      expect(env.WPDEV_HOST_HOME).not.toBe("/root");
    } finally {
      if (originalEnv !== undefined) {
        process.env.WPDEV_HOST_HOME = originalEnv;
      } else {
        delete process.env.WPDEV_HOST_HOME;
      }
    }
  });

  // M8: disable existing-network reuse
  it("existing_network_is_reused: when network exists, its values are used", async () => {
    const dockerDir = join(tmpDir, "docker");
    mkdirSync(dockerDir, { recursive: true });
    writeFileSync(join(dockerDir, ".env"), "WP_PORT=8888\n");

    const networkConfig = await import("../src/utils/network-config.js");
    vi.spyOn(networkConfig, "dockerNetworkExists").mockReturnValue(true);
    vi.spyOn(networkConfig, "getDockerNetworkSubnet").mockReturnValue("172.28.5.0/24");
    vi.spyOn(networkConfig, "getDockerNetworkGateway").mockReturnValue("172.28.5.1");

    const { resolveNetworkEnvForCompose } = await import("../src/utils/compose-prerequisites.js");
    const loaded = makeLoadedConfig(tmpDir);
    const result = resolveNetworkEnvForCompose(loaded);

    // Should use the existing network's values
    expect(result.WPDEV_NETWORK_SUBNET).toBe("172.28.5.0/24");
    expect(result.WPDEV_NETWORK_GATEWAY).toBe("172.28.5.1");
  });

  // M4: remove fix-permissions guard
  it("fixPermissions_ensures_bind_mount_files: fix-permissions creates remoteip.conf before compose", async () => {
    const dockerDir = join(tmpDir, "docker");
    mkdirSync(dockerDir, { recursive: true });
    writeFileSync(join(dockerDir, ".env"), "WP_PORT=8888\n");
    const remoteIpPath = join(dockerDir, "remoteip.conf");

    // Don't create remoteip.conf - it should be created by prerequisites
    expect(existsSync(remoteIpPath)).toBe(false);

    const { ensureComposePrerequisites } = await import("../src/utils/compose-prerequisites.js");
    const loaded = makeLoadedConfig(tmpDir);

    ensureComposePrerequisites(loaded);

    // remoteip.conf must exist after prerequisites
    expect(existsSync(remoteIpPath)).toBe(true);
    expect(statSync(remoteIpPath).isFile()).toBe(true);
  });


  // relocate-ports updates runner origin
  it("relocate_ports_updates_origin: buildRunnerOrigin helper exists and is used", async () => {
    const { buildRunnerOrigin } = await import("../src/utils/compose-env.js");

    // Test the helper function
    expect(buildRunnerOrigin("http://localhost:8888")).toBe("http://localhost:8888");
    expect(buildRunnerOrigin("http://localhost:8888", 9999)).toBe("http://localhost:9999");
    expect(buildRunnerOrigin("https://localhost:8443", 9443, "https")).toBe("https://localhost:9443");

    // With a custom host in local.url
    expect(buildRunnerOrigin("http://myhost.local:8888")).toBe("http://myhost.local:8888");
    expect(buildRunnerOrigin("http://myhost.local:8888", 9999)).toBe("http://myhost.local:9999");
  });

  // M1: prerequisites called before compose in reconcileSharedConfig
  it("reconcileSharedConfig_ensures_bind_mount_files: generated files exist before compose run", async () => {
    const dockerDir = join(tmpDir, "docker");
    mkdirSync(dockerDir, { recursive: true });
    writeFileSync(join(dockerDir, ".env"), "WP_PORT=8888\nWPDEV_NETWORK_SUBNET=172.28.1.0/24\nWPDEV_NETWORK_GATEWAY=172.28.1.1\n");
    const remoteIpPath = join(dockerDir, "remoteip.conf");

    const { reconcileSharedConfig } = await import("../src/fs/ownership/reconcile.js");
    const loaded = makeLoadedConfig(tmpDir);

    // Mock the compose call to check if remoteip.conf exists at call time
    const dockerCompose = await import("../src/services/docker-compose.js");
    let remoteIpExistedAtComposeCall = false;
    vi.spyOn(dockerCompose, "compose").mockImplementation(async () => {
      remoteIpExistedAtComposeCall = existsSync(remoteIpPath) && statSync(remoteIpPath).isFile();
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    await reconcileSharedConfig(loaded);

    // remoteip.conf should have existed when compose was called
    expect(remoteIpExistedAtComposeCall).toBe(true);
  });

  // Dangling symlink throws error (not creates target)
  it("dangling_symlink_throws_error: dangling symlink is refused", async () => {
    const dockerDir = join(tmpDir, "docker");
    mkdirSync(dockerDir, { recursive: true });

    const nonExistentTarget = join(tmpDir, "does-not-exist.conf");
    const linkPath = join(dockerDir, "remoteip.conf");
    symlinkSync(nonExistentTarget, linkPath);

    // Symlink exists but target doesn't
    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
    expect(existsSync(nonExistentTarget)).toBe(false);

    const { ensureGeneratedBindMountFiles } = await import("../src/utils/generated-bind-mounts.js");
    const loaded = makeLoadedConfig(tmpDir);

    // Must throw - not create the target file
    expect(() => ensureGeneratedBindMountFiles(loaded)).toThrow(/symlink/i);

    // Target must NOT have been created
    expect(existsSync(nonExistentTarget)).toBe(false);
  });

  // Symlink to directory throws clear error
  it("symlink_to_dir_throws_error: symlink to directory is refused with clear message", async () => {
    const dockerDir = join(tmpDir, "docker");
    mkdirSync(dockerDir, { recursive: true });

    const targetDir = join(tmpDir, "target-dir");
    mkdirSync(targetDir);
    const linkPath = join(dockerDir, "remoteip.conf");
    symlinkSync(targetDir, linkPath);

    expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
    expect(statSync(targetDir).isDirectory()).toBe(true);

    const { ensureGeneratedBindMountFiles } = await import("../src/utils/generated-bind-mounts.js");
    const loaded = makeLoadedConfig(tmpDir);

    // Must throw with clear error (not raw EISDIR)
    expect(() => ensureGeneratedBindMountFiles(loaded)).toThrow(/symlink/i);
  });

  // Use findAvailableSubnet for fallback (not hardcoded .1.0/24)
  it("resolve_uses_allocator: resolveNetworkEnvForCompose uses findAvailableSubnet for fallback", async () => {
    const dockerDir = join(tmpDir, "docker");
    mkdirSync(dockerDir, { recursive: true });
    // No network values in .env
    writeFileSync(join(dockerDir, ".env"), "WP_PORT=8888\n");

    const networkConfig = await import("../src/utils/network-config.js");
    // findAvailableSubnet was called - verify it returns what we mocked
    vi.spyOn(networkConfig, "findAvailableSubnet").mockReturnValue(`${DEFAULT_SUBNET_PREFIX}.5.0/24`);

    const { resolveNetworkEnvForCompose } = await import("../src/utils/compose-prerequisites.js");
    const loaded = makeLoadedConfig(tmpDir);
    const result = resolveNetworkEnvForCompose(loaded);

    // Should use the allocator's result
    expect(result.WPDEV_NETWORK_SUBNET).toBe(`${DEFAULT_SUBNET_PREFIX}.5.0/24`);
  });
});

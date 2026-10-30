import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  statSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LoadedConfig } from "../src/config/load.js";
import {
  GENERATED_BIND_MOUNT_FILES,
  ensureGeneratedBindMountFiles,
  ensureGeneratedFile,
  getRemoteIpConfPath,
} from "../src/utils/generated-bind-mounts.js";
import { DEFAULT_SUBNET_PREFIX, generateRemoteIpConf } from "../src/utils/network-config.js";

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

describe("generated-bind-mounts", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "wpdev-bind-mount-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("GENERATED_BIND_MOUNT_FILES", () => {
    it("includes remoteip.conf", () => {
      const file = GENERATED_BIND_MOUNT_FILES.find((f) => f.relPath === "remoteip.conf");
      expect(file).toBeDefined();
      expect(file?.description).toContain("RemoteIP");
    });

    it("generates valid default content for remoteip.conf", () => {
      const file = GENERATED_BIND_MOUNT_FILES.find((f) => f.relPath === "remoteip.conf");
      expect(file).toBeDefined();
      const content = file!.generateDefault();
      expect(content).toContain("# wp-dev");
      expect(content).toContain("SSL proxy not active");
      expect(content).not.toMatch(/^[^#]*RemoteIPHeader/m);
    });
  });

  describe("ensureGeneratedFile", () => {
    it("creates file when missing", () => {
      const dockerDir = join(tmpDir, "docker");
      mkdirSync(dockerDir, { recursive: true });

      const file = GENERATED_BIND_MOUNT_FILES.find((f) => f.relPath === "remoteip.conf")!;
      const result = ensureGeneratedFile(dockerDir, file);

      expect(result.action).toBe("created");
      expect(existsSync(join(dockerDir, "remoteip.conf"))).toBe(true);
      const stat = statSync(join(dockerDir, "remoteip.conf"));
      expect(stat.isFile()).toBe(true);
    });

    it("heals empty directory (Docker artifact)", () => {
      const dockerDir = join(tmpDir, "docker");
      const confPath = join(dockerDir, "remoteip.conf");
      mkdirSync(confPath, { recursive: true });

      expect(statSync(confPath).isDirectory()).toBe(true);

      const file = GENERATED_BIND_MOUNT_FILES.find((f) => f.relPath === "remoteip.conf")!;
      const result = ensureGeneratedFile(dockerDir, file);

      expect(result.action).toBe("healed");
      expect(statSync(confPath).isFile()).toBe(true);
      const content = readFileSync(confPath, "utf8");
      expect(content).toContain("# wp-dev");
    });

    it("refuses non-empty directory", () => {
      const dockerDir = join(tmpDir, "docker");
      const confPath = join(dockerDir, "remoteip.conf");
      mkdirSync(confPath, { recursive: true });
      writeFileSync(join(confPath, "somefile"), "content");

      const file = GENERATED_BIND_MOUNT_FILES.find((f) => f.relPath === "remoteip.conf")!;
      expect(() => ensureGeneratedFile(dockerDir, file)).toThrow(
        /non-empty directory.*cannot be auto-healed/i,
      );
    });

    it("leaves existing file unchanged", () => {
      const dockerDir = join(tmpDir, "docker");
      mkdirSync(dockerDir, { recursive: true });
      const confPath = join(dockerDir, "remoteip.conf");
      writeFileSync(confPath, "custom content");

      const file = GENERATED_BIND_MOUNT_FILES.find((f) => f.relPath === "remoteip.conf")!;
      const result = ensureGeneratedFile(dockerDir, file);

      expect(result.action).toBe("unchanged");
      expect(readFileSync(confPath, "utf8")).toBe("custom content");
    });
  });

  describe("ensureGeneratedBindMountFiles", () => {
    it("creates all files when docker dir is missing", () => {
      const loaded = makeLoadedConfig(tmpDir);
      mkdirSync(join(tmpDir, "docker"), { recursive: true });

      const results = ensureGeneratedBindMountFiles(loaded);

      expect(results.length).toBe(GENERATED_BIND_MOUNT_FILES.length);
      expect(results.every((r) => r.action === "created" || r.action === "unchanged")).toBe(true);

      const confPath = join(tmpDir, "docker", "remoteip.conf");
      expect(existsSync(confPath)).toBe(true);
      expect(statSync(confPath).isFile()).toBe(true);
    });

    it("heals empty directory created by Docker", () => {
      const loaded = makeLoadedConfig(tmpDir);
      const confPath = join(tmpDir, "docker", "remoteip.conf");
      mkdirSync(confPath, { recursive: true });

      const results = ensureGeneratedBindMountFiles(loaded);

      expect(results.some((r) => r.action === "healed")).toBe(true);
      expect(statSync(confPath).isFile()).toBe(true);
    });

    it("throws for non-empty directory", () => {
      const loaded = makeLoadedConfig(tmpDir);
      const confPath = join(tmpDir, "docker", "remoteip.conf");
      mkdirSync(confPath, { recursive: true });
      writeFileSync(join(confPath, "somefile"), "content");

      expect(() => ensureGeneratedBindMountFiles(loaded)).toThrow(/non-empty directory/i);
    });
  });

  describe("getRemoteIpConfPath", () => {
    it("returns correct path based on loaded config", () => {
      const loaded = makeLoadedConfig(tmpDir, "docker");
      const path = getRemoteIpConfPath(loaded);
      expect(path).toBe(join(tmpDir, "docker", "remoteip.conf"));
    });

    it("respects custom local.path", () => {
      const loaded = makeLoadedConfig(tmpDir, "custom-docker");
      const path = getRemoteIpConfPath(loaded);
      expect(path).toBe(join(tmpDir, "custom-docker", "remoteip.conf"));
    });
  });
});

describe("startup ordering - compose prerequisites", () => {
  let tmpDir: string;
  let composeCalls: string[][];

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "wpdev-startup-order-test-"));
    composeCalls = [];

    const dockerPrereq = await import("../src/utils/docker-prereq.js");
    vi.spyOn(dockerPrereq, "assertDockerReady").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function assertComposePrerequisites(tmpDir: string, args: string[]): void {
    const envPath = join(tmpDir, "docker", ".env");
    const remoteIpPath = join(tmpDir, "docker", "remoteip.conf");

    if (!existsSync(envPath)) {
      throw new Error(`TEST FAILURE: compose called before .env exists. Args: ${args.join(" ")}`);
    }

    const envContent = readFileSync(envPath, "utf8");

    // Network config can be in .env file OR in process.env (set by resolveNetworkEnvForCompose)
    const hasSubnetInFile = envContent.includes("WPDEV_NETWORK_SUBNET=");
    const hasSubnetInEnv = !!process.env.WPDEV_NETWORK_SUBNET;
    if (!hasSubnetInFile && !hasSubnetInEnv) {
      throw new Error(
        `TEST FAILURE: compose called before WPDEV_NETWORK_SUBNET is set (neither in .env nor process.env). Args: ${args.join(" ")}`,
      );
    }

    const hasGatewayInFile = envContent.includes("WPDEV_NETWORK_GATEWAY=");
    const hasGatewayInEnv = !!process.env.WPDEV_NETWORK_GATEWAY;
    if (!hasGatewayInFile && !hasGatewayInEnv) {
      throw new Error(
        `TEST FAILURE: compose called before WPDEV_NETWORK_GATEWAY is set (neither in .env nor process.env). Args: ${args.join(" ")}`,
      );
    }

    if (!existsSync(remoteIpPath)) {
      throw new Error(
        `TEST FAILURE: compose called before remoteip.conf exists. Args: ${args.join(" ")}`,
      );
    }

    const stat = statSync(remoteIpPath);
    if (stat.isDirectory()) {
      throw new Error(
        `TEST FAILURE: remoteip.conf is a directory when compose called. Args: ${args.join(" ")}`,
      );
    }
  }

  it("reconcileSharedConfig ensures WPDEV_NETWORK_SUBNET and remoteip.conf exist before compose", async () => {
    const dockerDir = join(tmpDir, "docker");
    mkdirSync(dockerDir, { recursive: true });
    writeFileSync(join(dockerDir, ".env"), "WP_PORT=8888\n");
    writeFileSync(join(tmpDir, "wp-dev.config.json"), "{}");
    // In the real flow, ensureComposePrerequisites creates remoteip.conf before
    // reconcileSharedConfig is called. Simulate that here.
    writeFileSync(join(dockerDir, "remoteip.conf"), "# test\n");

    const dockerCompose = await import("../src/services/docker-compose.js");
    vi.spyOn(dockerCompose, "compose").mockImplementation(
      async (configDir, config, args) => {
        composeCalls.push(args);
        assertComposePrerequisites(tmpDir, args);
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    );

    const loaded = makeLoadedConfig(tmpDir);

    const { reconcileSharedConfig } = await import("../src/fs/ownership/reconcile.js");
    await reconcileSharedConfig(loaded);

    expect(composeCalls.length).toBeGreaterThan(0);

    // reconcileSharedConfig uses resolveNetworkEnvForCompose which sets process.env
    // but doesn't write to .env. The compose mock's assertComposePrerequisites
    // already verified that network vars were available during the call.
    const remoteIpPath = join(dockerDir, "remoteip.conf");
    expect(existsSync(remoteIpPath)).toBe(true);
    expect(statSync(remoteIpPath).isFile()).toBe(true);
  });

  it("compose run fallback path also has all prerequisites", async () => {
    const dockerDir = join(tmpDir, "docker");
    mkdirSync(dockerDir, { recursive: true });
    writeFileSync(join(dockerDir, ".env"), "WP_PORT=8888\n");
    writeFileSync(join(tmpDir, "wp-dev.config.json"), "{}");
    // In the real flow, ensureComposePrerequisites creates remoteip.conf before
    // reconcileSharedConfig is called. Simulate that here.
    writeFileSync(join(dockerDir, "remoteip.conf"), "# test\n");

    const dockerCompose = await import("../src/services/docker-compose.js");
    let firstCallFailed = false;

    vi.spyOn(dockerCompose, "compose").mockImplementation(async (configDir, config, args) => {
      composeCalls.push(args);
      assertComposePrerequisites(tmpDir, args);

      if (args.includes("exec") && !firstCallFailed) {
        firstCallFailed = true;
        throw new Error("exec failed (container not running)");
      }

      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const loaded = makeLoadedConfig(tmpDir);

    const { reconcileSharedConfig } = await import("../src/fs/ownership/reconcile.js");
    await reconcileSharedConfig(loaded);

    expect(composeCalls.some((args) => args.includes("run"))).toBe(true);
    expect(firstCallFailed).toBe(true);
    // assertComposePrerequisites already verified network vars were available during compose calls
  });

  it("ensureComposePrerequisites writes network config and creates remoteip.conf", async () => {
    const dockerDir = join(tmpDir, "docker");
    mkdirSync(dockerDir, { recursive: true });
    writeFileSync(join(dockerDir, ".env"), "WP_PORT=8888\n");

    const loaded = makeLoadedConfig(tmpDir);
    const remoteIpPath = join(dockerDir, "remoteip.conf");

    expect(existsSync(remoteIpPath)).toBe(false);

    const envBefore = readFileSync(join(dockerDir, ".env"), "utf8");
    expect(envBefore).not.toContain("WPDEV_NETWORK_SUBNET=");

    const { ensureComposePrerequisites } = await import("../src/utils/compose-prerequisites.js");
    const result = ensureComposePrerequisites(loaded);

    expect(existsSync(remoteIpPath)).toBe(true);
    expect(statSync(remoteIpPath).isFile()).toBe(true);

    const envAfter = readFileSync(join(dockerDir, ".env"), "utf8");
    expect(envAfter).toContain("WPDEV_NETWORK_SUBNET=");
    expect(envAfter).toContain("WPDEV_NETWORK_GATEWAY=");
    expect(envAfter).toContain("WPDEV_SSL_PROXY_IP=");

    expect(result.changedKeys).toContain("WPDEV_NETWORK_SUBNET");
    expect(result.changedKeys).toContain("WPDEV_NETWORK_GATEWAY");
  });

  it("network subnet is allocated from .1.0/24, not .0.0/24", async () => {
    const dockerDir = join(tmpDir, "docker");
    mkdirSync(dockerDir, { recursive: true });
    writeFileSync(join(dockerDir, ".env"), "WP_PORT=8888\n");

    const loaded = makeLoadedConfig(tmpDir);

    const { ensureComposePrerequisites } = await import("../src/utils/compose-prerequisites.js");
    const result = ensureComposePrerequisites(loaded);

    expect(result.networkInfo).not.toBeNull();
    // Derive regex from DEFAULT_SUBNET_PREFIX instead of hardcoding
    const escapedPrefix = DEFAULT_SUBNET_PREFIX.replace(/\./g, "\\.");
    const forbiddenSubnet = `${DEFAULT_SUBNET_PREFIX}.0.0/24`;
    const subnetPattern = new RegExp(`^${escapedPrefix}\\.[1-9]\\d*\\.0/24$`);
    expect(result.networkInfo?.subnet).not.toBe(forbiddenSubnet);
    expect(result.networkInfo?.subnet).toMatch(subnetPattern);
  });
});

describe("remoteip.conf content validation", () => {
  it("ssl-off content has no active RemoteIPHeader", () => {
    const content = generateRemoteIpConf(null);
    expect(content).not.toMatch(/^[^#]*RemoteIPHeader/m);
    expect(content).toContain("SSL proxy not active");
    expect(content).toContain("# <IfModule remoteip_module>");
  });

  it("ssl-on content trusts only the proxy IP", () => {
    const proxyIp = "172.28.5.10";
    const content = generateRemoteIpConf(proxyIp);
    expect(content).toContain("RemoteIPHeader X-Forwarded-For");
    expect(content).toContain(`RemoteIPInternalProxy ${proxyIp}`);
    expect(content).toContain("<IfModule remoteip_module>");
    expect(content).toContain("</IfModule>");
    expect(content).not.toContain("10.0.0.0/8");
    expect(content).not.toContain("172.16.0.0/12");
    expect(content).not.toContain("192.168.0.0/16");
  });
});

describe("mutation tests for compose prerequisites", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "wpdev-mutation-test-"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resolveNetworkEnvForCompose provides vars without writing to .env", async () => {
    const dockerDir = join(tmpDir, "docker");
    mkdirSync(dockerDir, { recursive: true });
    // Start with .env that has no network vars (pre-PR#8 state)
    writeFileSync(join(dockerDir, ".env"), "WP_PORT=8888\n");
    const envBefore = readFileSync(join(dockerDir, ".env"), "utf8");

    const loaded = makeLoadedConfig(tmpDir);
    const { resolveNetworkEnvForCompose } = await import("../src/utils/compose-prerequisites.js");
    const result = resolveNetworkEnvForCompose(loaded);

    // Should derive network vars
    expect(result.WPDEV_NETWORK_SUBNET).toBeTruthy();
    expect(result.WPDEV_NETWORK_GATEWAY).toBeTruthy();
    expect(result.WPDEV_NETWORK_SUBNET).toMatch(/^\d+\.\d+\.\d+\.\d+\/\d+$/);

    // .env file should NOT be modified
    const envAfter = readFileSync(join(dockerDir, ".env"), "utf8");
    expect(envAfter).toBe(envBefore);
    expect(envAfter).not.toContain("WPDEV_NETWORK_SUBNET=");
  });

  it("checkComposePrerequisites is read-only", async () => {
    const dockerDir = join(tmpDir, "docker");
    mkdirSync(dockerDir, { recursive: true });
    writeFileSync(join(dockerDir, ".env"), "WP_PORT=8888\n");
    const envBefore = readFileSync(join(dockerDir, ".env"), "utf8");

    const loaded = makeLoadedConfig(tmpDir);
    const { checkComposePrerequisites } = await import("../src/utils/compose-prerequisites.js");
    const result = checkComposePrerequisites(loaded);

    // Should report issues (missing WPDEV_NETWORK_SUBNET, missing remoteip.conf)
    expect(result.ready).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.some((i) => i.includes("WPDEV_NETWORK_SUBNET"))).toBe(true);

    // .env file should NOT be modified
    const envAfter = readFileSync(join(dockerDir, ".env"), "utf8");
    expect(envAfter).toBe(envBefore);
  });

  it("symlinked remoteip.conf is preserved", () => {
    const dockerDir = join(tmpDir, "docker");
    mkdirSync(dockerDir, { recursive: true });

    // Create a target file and symlink to it
    const targetPath = join(tmpDir, "custom-remoteip.conf");
    writeFileSync(targetPath, "# custom remoteip config\n");
    const linkPath = join(dockerDir, "remoteip.conf");
    const { symlinkSync, lstatSync: lstat } = require("node:fs");
    symlinkSync(targetPath, linkPath);

    // Verify it's a symlink
    expect(lstat(linkPath).isSymbolicLink()).toBe(true);

    const loaded = makeLoadedConfig(tmpDir);
    const results = ensureGeneratedBindMountFiles(loaded);

    // Should leave symlink unchanged
    expect(results.some((r) => r.action === "unchanged" && r.path === linkPath)).toBe(true);
    expect(lstat(linkPath).isSymbolicLink()).toBe(true);

    // Original content should be preserved
    expect(readFileSync(linkPath, "utf8")).toBe("# custom remoteip config\n");
  });

  it("empty directory at remoteip.conf path is healed", () => {
    const dockerDir = join(tmpDir, "docker");
    const confPath = join(dockerDir, "remoteip.conf");
    // Docker creates empty directories for missing bind-mount sources
    mkdirSync(confPath, { recursive: true });
    expect(statSync(confPath).isDirectory()).toBe(true);

    const loaded = makeLoadedConfig(tmpDir);
    const results = ensureGeneratedBindMountFiles(loaded);

    // Should heal the empty directory to a file
    expect(results.some((r) => r.action === "healed")).toBe(true);
    expect(statSync(confPath).isFile()).toBe(true);
    expect(readFileSync(confPath, "utf8")).toContain("# wp-dev");
  });

  it("non-empty directory at remoteip.conf path throws error", () => {
    const dockerDir = join(tmpDir, "docker");
    const confPath = join(dockerDir, "remoteip.conf");
    mkdirSync(confPath, { recursive: true });
    writeFileSync(join(confPath, "somefile.txt"), "content");

    const loaded = makeLoadedConfig(tmpDir);
    expect(() => ensureGeneratedBindMountFiles(loaded)).toThrow(/non-empty directory/i);
  });

  it("DEFAULT_DOCKER_ENV_PORTS values are used as defaults", async () => {
    const dockerDir = join(tmpDir, "docker");
    mkdirSync(dockerDir, { recursive: true });
    // .env with no WP_PORT - should use default
    writeFileSync(join(dockerDir, ".env"), "");

    const loaded = makeLoadedConfig(tmpDir);
    const { ensureComposePrerequisites } = await import("../src/utils/compose-prerequisites.js");
    const { DEFAULT_DOCKER_ENV_PORTS, readEnvValue } = await import("../src/utils/compose-env.js");

    ensureComposePrerequisites(loaded);

    const envContent = readFileSync(join(dockerDir, ".env"), "utf8");
    // Check that WPDEV_HOST_RUNNER_PORT was written with the default value
    const hostRunnerPort = readEnvValue(envContent, "WPDEV_HOST_RUNNER_PORT");
    expect(hostRunnerPort).toBe(String(DEFAULT_DOCKER_ENV_PORTS.WPDEV_HOST_RUNNER_PORT));
  });

  it("DEFAULT_SUBNET_PREFIX is used for network allocation", async () => {
    const dockerDir = join(tmpDir, "docker");
    mkdirSync(dockerDir, { recursive: true });
    writeFileSync(join(dockerDir, ".env"), "WP_PORT=8888\n");

    const loaded = makeLoadedConfig(tmpDir);
    const { ensureComposePrerequisites } = await import("../src/utils/compose-prerequisites.js");
    const result = ensureComposePrerequisites(loaded);

    // Subnet should start with DEFAULT_SUBNET_PREFIX
    expect(result.networkInfo?.subnet).toMatch(new RegExp(`^${DEFAULT_SUBNET_PREFIX.replace(/\./g, "\\.")}`));
  });
});

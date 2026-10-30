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
import { generateRemoteIpConf } from "../src/utils/network-config.js";

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

    if (!envContent.includes("WPDEV_NETWORK_SUBNET=")) {
      throw new Error(
        `TEST FAILURE: compose called before WPDEV_NETWORK_SUBNET is set in .env. Args: ${args.join(" ")}`,
      );
    }

    if (!envContent.includes("WPDEV_NETWORK_GATEWAY=")) {
      throw new Error(
        `TEST FAILURE: compose called before WPDEV_NETWORK_GATEWAY is set in .env. Args: ${args.join(" ")}`,
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

    const envContent = readFileSync(join(dockerDir, ".env"), "utf8");
    expect(envContent).toContain("WPDEV_NETWORK_SUBNET=");
    expect(envContent).toContain("WPDEV_NETWORK_GATEWAY=");

    const remoteIpPath = join(dockerDir, "remoteip.conf");
    expect(existsSync(remoteIpPath)).toBe(true);
    expect(statSync(remoteIpPath).isFile()).toBe(true);
  });

  it("compose run fallback path also has all prerequisites", async () => {
    const dockerDir = join(tmpDir, "docker");
    mkdirSync(dockerDir, { recursive: true });
    writeFileSync(join(dockerDir, ".env"), "WP_PORT=8888\n");
    writeFileSync(join(tmpDir, "wp-dev.config.json"), "{}");

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

    const envContent = readFileSync(join(dockerDir, ".env"), "utf8");
    expect(envContent).toContain("WPDEV_NETWORK_SUBNET=");
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
    expect(result.networkInfo?.subnet).not.toBe("172.28.0.0/24");
    expect(result.networkInfo?.subnet).toMatch(/^172\.28\.[1-9]\d*\.0\/24$/);
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

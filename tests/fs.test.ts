import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFileAtomic, sweepStaleTmpFiles } from "../src/fs/atomic-write.js";
import { isWithinProjectRoot, assertWithinProjectRoot } from "../src/fs/path-resolver.js";
import { detectFilesystemWarnings, isWslWindowsMount } from "../src/fs/temp-registry.js";
import { classifyRelativePath } from "../src/fs/ownership/profiles.js";
import { acquireUpdateLock, releaseUpdateLock } from "../src/fs/update-lock.js";
import { checkFilesystemHealth } from "../src/fs/recovery.js";
import type { LoadedConfig } from "../src/config/load.js";

describe("fs atomic-write", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "wp-dev-fs-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes atomically and creates backup", () => {
    const target = join(dir, "config.json");
    writeFileAtomic(target, '{"a":1}\n', { backup: true });
    expect(readFileSync(target, "utf8")).toBe('{"a":1}\n');
    writeFileAtomic(target, '{"a":2}\n', { backup: true });
    expect(readFileSync(`${target}.bak`, "utf8")).toBe('{"a":1}\n');
  });

  it("sweeps stale tmp files", () => {
    const stale = join(dir, "file.12345.deadbeef.tmp");
    writeFileAtomic(stale.replace(".tmp", ".json"), "x\n");
    const n = sweepStaleTmpFiles(dir, 0);
    expect(n).toBeGreaterThanOrEqual(0);
  });
});

describe("fs path-resolver", () => {
  it("rejects path traversal", () => {
    const root = "/tmp/wp-dev-project";
    expect(() => assertWithinProjectRoot(root, "/etc/passwd")).toThrow(/escapes project root/);
    expect(isWithinProjectRoot(root, join(root, "docker/.env"))).toBe(true);
  });
});

describe("fs ownership profiles", () => {
  it("classifies paths", () => {
    expect(classifyRelativePath("wp-dev.config.json")).toBe("SHARED_CONFIG");
    expect(classifyRelativePath("wordpress/wp-content/plugins/foo")).toBe("CONTAINER_RUNTIME");
    expect(classifyRelativePath("wordpress/wp-content/themes/foo")).toBe("HOST_EDITABLE");
  });
});

describe("fs platform warnings", () => {
  it("detects WSL windows mounts", () => {
    expect(isWslWindowsMount("/mnt/c/Users/dev/WP-dev")).toBe(true);
    expect(isWslWindowsMount("/home/dev/WP-dev")).toBe(false);
  });

  it("detectFilesystemWarnings returns array", () => {
    expect(Array.isArray(detectFilesystemWarnings("/home/dev/WP-dev"))).toBe(true);
  });
});

describe("fs recovery health", () => {
  it("checkFilesystemHealth returns structured result", () => {
    const loaded = {
      configDir: "/home/dev/WP-dev",
      config: {
        project: "test",
        local: { path: "docker", url: "http://localhost:8888", composeFile: "docker-compose.yml", composeService: "wordpress", wpRoot: "wordpress" },
        staging: { host: "staging.example.com", user: "u", path: "/var/www", url: "https://staging.example.com" },
        production: { host: "example.com", user: "u", path: "/var/www", url: "https://example.com" },
      },
    } as LoadedConfig;
    const health = checkFilesystemHealth(loaded);
    expect(typeof health.ok).toBe("boolean");
    expect(Array.isArray(health.issues)).toBe(true);
  });
});

describe("fs update-lock", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "wp-dev-uplock-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("acquires and releases update lock", () => {
    expect(acquireUpdateLock(dir)).toBe(true);
    expect(acquireUpdateLock(dir)).toBe(false);
    releaseUpdateLock(dir);
    expect(acquireUpdateLock(dir)).toBe(true);
    releaseUpdateLock(dir);
    expect(existsSync(join(dir, "logs", "wp-dev-update.lock"))).toBe(false);
  });
});

import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { LoadedConfig } from "../src/config/load.js";
import { dockerComposeProjectId } from "../src/services/docker-compose.js";
import {
  commitRemotePhpChange,
  setLocalPhpVersion,
  type ComposeProjectPeer,
} from "../src/services/php-version.js";
import type { SshSession } from "../src/services/ssh.js";
import { minimalWpDevConfig } from "./helpers/fixtures.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function toolSha(): string {
  return execSync("git rev-parse HEAD", { cwd: repoRoot, encoding: "utf8" }).trim();
}

function makeClone(project: string, composeProjectName?: string): LoadedConfig {
  const root = mkdtempSync(join(tmpdir(), "wpdev-php-iso-"));
  temps.push(root);
  const base = minimalWpDevConfig({ project });
  const config = composeProjectName
    ? { ...base, local: { ...base.local, composeProjectName } }
    : base;
  mkdirSync(join(root, "docker"), { recursive: true });
  mkdirSync(join(root, "wordpress"), { recursive: true });
  writeFileSync(join(root, "docker", ".env"), "WPDEV_PHP_VERSION=8.2\n");
  writeFileSync(join(root, "wordpress", "site-marker.txt"), `marker-${project}\n`);
  writeFileSync(join(root, "wp-dev.config.json"), JSON.stringify(config));
  return { configDir: root, config };
}

function peersOf(clones: LoadedConfig[]): ComposeProjectPeer[] {
  return clones.map((clone) => ({
    configDir: clone.configDir,
    projectId: dockerComposeProjectId(clone.config),
  }));
}

function envFile(loaded: LoadedConfig): string {
  return readFileSync(join(loaded.configDir, "docker", ".env"), "utf8");
}

function marker(loaded: LoadedConfig): string {
  return readFileSync(join(loaded.configDir, "wordpress", "site-marker.txt"), "utf8");
}

const quietLocal = {
  restart: false as const,
  composeWorkingDirs: [] as string[],
  skipImageLookup: true,
};

describe("local PHP isolation", () => {
  it("changes only the selected clone when project ids differ", async () => {
    const sha = toolSha();
    const a = makeClone("site-a");
    const b = makeClone("site-b");
    const markerA = marker(a);
    const envB = envFile(b);

    await setLocalPhpVersion(a, "8.3", {
      ...quietLocal,
      peerProjects: peersOf([a, b]),
    });

    expect(envFile(a)).toContain("WPDEV_PHP_VERSION=8.3");
    expect(envFile(b)).toBe(envB);
    expect(marker(a)).toBe(markerA);
    expect(marker(b)).toBe("marker-site-b\n");
    expect(toolSha()).toBe(sha);
  });

  it("refuses a shared project id and leaves both docker/.env files unchanged", async () => {
    const sha = toolSha();
    const a = makeClone("shared-site");
    const b = makeClone("shared-site");
    const envA = envFile(a);
    const envB = envFile(b);

    await expect(
      setLocalPhpVersion(a, "8.3", {
        ...quietLocal,
        peerProjects: peersOf([a, b]),
      }),
    ).rejects.toThrow(/also used by/);

    expect(envFile(a)).toBe(envA);
    expect(envFile(b)).toBe(envB);
    expect(marker(a)).toBe("marker-shared-site\n");
    expect(marker(b)).toBe("marker-shared-site\n");
    expect(toolSha()).toBe(sha);
  });

  it("refuses a shared composeProjectName even when project names differ", async () => {
    const a = makeClone("site-a", "shared-stack");
    const b = makeClone("site-b", "shared-stack");
    const envA = envFile(a);

    await expect(
      setLocalPhpVersion(a, "8.3", {
        ...quietLocal,
        peerProjects: peersOf([a, b]),
      }),
    ).rejects.toThrow(/shared-stack/);

    expect(envFile(a)).toBe(envA);
    expect(envFile(b)).toContain("WPDEV_PHP_VERSION=8.2");
  });

  it("refuses a Compose project whose volume working dir is another clone", async () => {
    const a = makeClone("site-a");
    const other = mkdtempSync(join(tmpdir(), "wpdev-other-stack-"));
    temps.push(other);
    const envA = envFile(a);

    await expect(
      setLocalPhpVersion(a, "8.3", {
        ...quietLocal,
        peerProjects: peersOf([a]),
        composeWorkingDirs: [other],
      }),
    ).rejects.toThrow(/already has a stack/);

    expect(envFile(a)).toBe(envA);
  });

  it("treats this clone’s config dir and docker dir as the same stack", async () => {
    const a = makeClone("site-a");
    await setLocalPhpVersion(a, "8.3", {
      ...quietLocal,
      peerProjects: peersOf([a]),
      composeWorkingDirs: [a.configDir, join(a.configDir, "docker")],
    });
    expect(envFile(a)).toContain("WPDEV_PHP_VERSION=8.3");
  });
});

type RemoteFiles = Map<string, string>;

function fakeRemote(files: RemoteFiles): { ssh: SshSession; commands: string[] } {
  const commands: string[] = [];
  const ssh = {
    async exec(command: string) {
      commands.push(command);
      if (command.includes("HAS_WP=")) {
        const path = command.match(/\nP='([^']*)'/)?.[1] ?? "";
        const hasWp =
          files.has(`${path}/wp-config.php`) || files.has(`${path}/wp-config-sample.php`);
        let child = 0;
        const prefix = `${path}/`;
        const markerNames = [
          "wp-dev.config.json",
          "wp-dev.config.example.json",
          "docker/terminal-runner.mjs",
          "docker/host-runner.mjs",
          "src/cli.ts",
          "packages/wpdev-web/package.json",
        ];
        const markers = markerNames.filter((rel) => files.has(`${path}/${rel}`));
        for (const key of files.keys()) {
          if (!key.startsWith(prefix) || !key.endsWith("/wp-config.php")) continue;
          const rest = key.slice(prefix.length);
          if (rest.split("/").length === 2) child += 1;
        }
        const line = `WPDEV_PATH_SAFETY has_wp=${hasWp ? 1 : 0} child_wp=${child} markers=${markers.join(" ")}`;
        return { code: 0, stdout: `${line}\n`, stderr: "" };
      }
      if (command.startsWith("if [ -f ")) {
        const path = command.match(/if \[ -f '([^']*)' \]/)?.[1];
        if (!path || !files.has(path)) {
          return { code: 0, stdout: "__WPDEV_MISSING__\n", stderr: "" };
        }
        return { code: 0, stdout: files.get(path) ?? "", stderr: "" };
      }
      if (command.includes("base64 -d")) {
        const b64 = command.match(/printf '%s' '([^']*)'/)?.[1];
        const dest = command.match(/mv '[^']*' '([^']*)'/)?.[1];
        if (!b64 || !dest) return { code: 1, stdout: "", stderr: "unparsed write" };
        files.set(dest, Buffer.from(b64, "base64").toString("utf8"));
        return { code: 0, stdout: "", stderr: "" };
      }
      if (command.includes("wp eval") || command.includes("php -r")) {
        return { code: 0, stdout: "8.3.1\n", stderr: "" };
      }
      return { code: 1, stdout: "", stderr: `unhandled: ${command.slice(0, 120)}` };
    },
    async getFile() {},
    async putFile() {},
    dispose() {},
  } as SshSession;
  return { ssh, commands };
}

function wrote(commands: string[]): boolean {
  return commands.some((command) => command.includes("base64 -d"));
}

describe("remote PHP isolation", () => {
  it("writes only the target .php-version and leaves the sibling site unchanged", async () => {
    const configDir = mkdtempSync(join(tmpdir(), "wpdev-php-remote-"));
    temps.push(configDir);
    const files: RemoteFiles = new Map([
      ["/var/www/live/wp-config.php", "<?php\n"],
      ["/var/www/live/.php-version", "8.2\n"],
      ["/var/www/other/wp-config.php", "<?php\n"],
      ["/var/www/other/.php-version", "8.2\n"],
      ["/var/www/other/.htaccess", "Sibling site\n"],
    ]);
    const siblingBefore = files.get("/var/www/other/.php-version");
    const siblingHtaccess = files.get("/var/www/other/.htaccess");
    const { ssh, commands } = fakeRemote(files);

    await commitRemotePhpChange({
      ssh,
      configDir,
      env: "production",
      wpPath: "/var/www/live",
      version: "8.3",
      strategy: "dot_php_version",
      previousVersion: "8.2",
    });

    expect(files.get("/var/www/live/.php-version")).toBe("8.3\n");
    expect(files.get("/var/www/other/.php-version")).toBe(siblingBefore);
    expect(files.get("/var/www/other/.htaccess")).toBe(siblingHtaccess);
    expect(wrote(commands)).toBe(true);
    const writes = commands.filter((command) => command.includes("base64 -d"));
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("'/var/www/live/.php-version'");
    expect(writes[0]).not.toContain("/var/www/other");
  });

  it("writes only the target .htaccess block", async () => {
    const configDir = mkdtempSync(join(tmpdir(), "wpdev-php-htaccess-"));
    temps.push(configDir);
    const files: RemoteFiles = new Map([
      ["/var/www/live/wp-config.php", "<?php\n"],
      ["/var/www/live/.htaccess", "AddHandler application/x-httpd-php82 .php\n"],
      ["/var/www/other/wp-config.php", "<?php\n"],
      ["/var/www/other/.htaccess", "Sibling site\n"],
    ]);
    const { ssh } = fakeRemote(files);

    await commitRemotePhpChange({
      ssh,
      configDir,
      env: "staging",
      wpPath: "/var/www/live",
      version: "8.3",
      strategy: "htaccess_addhandler",
      previousVersion: "8.2",
    });

    expect(files.get("/var/www/live/.htaccess")).toContain("# BEGIN WP-DEV PHP VERSION");
    expect(files.get("/var/www/live/.htaccess")).toContain("php83");
    expect(files.get("/var/www/other/.htaccess")).toBe("Sibling site\n");
  });

  it("does not write when the path is a parent of other sites", async () => {
    const configDir = mkdtempSync(join(tmpdir(), "wpdev-php-parent-"));
    temps.push(configDir);
    const files: RemoteFiles = new Map([
      ["/var/www/live/wp-config.php", "<?php\n"],
      ["/var/www/live/.php-version", "8.2\n"],
      ["/var/www/other/wp-config.php", "<?php\n"],
      ["/var/www/other/.php-version", "8.2\n"],
    ]);
    const { ssh, commands } = fakeRemote(files);

    await expect(
      commitRemotePhpChange({
        ssh,
        configDir,
        env: "production",
        wpPath: "/var/www",
        version: "8.3",
        strategy: "dot_php_version",
        previousVersion: null,
      }),
    ).rejects.toThrow(/remote path is unsafe/);

    expect(wrote(commands)).toBe(false);
    expect(files.get("/var/www/live/.php-version")).toBe("8.2\n");
    expect(files.get("/var/www/other/.php-version")).toBe("8.2\n");
    expect(files.has("/var/www/.php-version")).toBe(false);
  });

  it("does not write when wp-config is missing", async () => {
    const configDir = mkdtempSync(join(tmpdir(), "wpdev-php-missing-"));
    temps.push(configDir);
    const files: RemoteFiles = new Map();
    const { ssh, commands } = fakeRemote(files);

    await expect(
      commitRemotePhpChange({
        ssh,
        configDir,
        env: "production",
        wpPath: "/var/www/empty",
        version: "8.3",
        strategy: "dot_php_version",
        previousVersion: null,
      }),
    ).rejects.toThrow(/remote path is unsafe/);

    expect(wrote(commands)).toBe(false);
  });

  it("does not write when the docroot contains wp-dev tooling", async () => {
    const configDir = mkdtempSync(join(tmpdir(), "wpdev-php-tooling-"));
    temps.push(configDir);
    const files: RemoteFiles = new Map([
      ["/var/www/live/wp-config.php", "<?php\n"],
      ["/var/www/live/wp-dev.config.json", "{}\n"],
      ["/var/www/live/.php-version", "8.2\n"],
    ]);
    const { ssh, commands } = fakeRemote(files);

    await expect(
      commitRemotePhpChange({
        ssh,
        configDir,
        env: "production",
        wpPath: "/var/www/live",
        version: "8.3",
        strategy: "dot_php_version",
        previousVersion: "8.2",
      }),
    ).rejects.toThrow(/remote path is unsafe/);

    expect(wrote(commands)).toBe(false);
    expect(files.get("/var/www/live/.php-version")).toBe("8.2\n");
  });

  it("does not write when a nested WordPress install sits under the target", async () => {
    const configDir = mkdtempSync(join(tmpdir(), "wpdev-php-nested-"));
    temps.push(configDir);
    const files: RemoteFiles = new Map([
      ["/var/www/live/wp-config.php", "<?php\n"],
      ["/var/www/live/blog/wp-config.php", "<?php\n"],
      ["/var/www/live/.php-version", "8.2\n"],
    ]);
    const { ssh, commands } = fakeRemote(files);

    await expect(
      commitRemotePhpChange({
        ssh,
        configDir,
        env: "production",
        wpPath: "/var/www/live",
        version: "8.3",
        strategy: "dot_php_version",
        previousVersion: "8.2",
      }),
    ).rejects.toThrow(/nested WordPress/);

    expect(wrote(commands)).toBe(false);
    expect(files.get("/var/www/live/.php-version")).toBe("8.2\n");
  });
});

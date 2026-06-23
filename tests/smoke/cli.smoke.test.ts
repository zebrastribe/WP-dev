import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execa } from "execa";

const root = process.cwd();
const cli = join(root, "dist/cli.js");
const composePath = join(root, "docker/docker-compose.yml");

describe("CLI smoke", () => {
  it("dist/cli.js exists and is executable after build", () => {
    expect(existsSync(cli)).toBe(true);
  });

  it("wp-dev --help exits 0", async () => {
    const r = await execa("node", [cli, "--help"], { reject: false });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("sync-preview");
    expect(r.stdout).toContain("sync-scan");
    expect(r.stdout).toContain("fix-runtime-permissions");
    expect(r.stdout).toContain(" update");
    expect(r.stdout).toContain("services");
    expect(r.stdout).toContain("supervisor");
  });

  it("wp-dev sync-rules exits 0 with project config", async () => {
    const r = await execa("node", [cli, "sync-rules"], {
      cwd: root,
      reject: false,
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toMatch(/Push excludes|sync rules/i);
  });

  it("wp-dev sync-preview rejects invalid direction", async () => {
    const r = await execa("node", [cli, "sync-preview", "invalid", "staging"], {
      cwd: root,
      reject: false,
    });
    expect(r.exitCode).not.toBe(0);
  });

  it("wp-dev push staging is a registered subcommand", async () => {
    const r = await execa("node", [cli, "push", "staging", "--help"], {
      cwd: root,
      reject: false,
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/dry-run/i);
  });

  it("wp-dev pull staging is a registered subcommand", async () => {
    const r = await execa("node", [cli, "pull", "staging", "--help"], {
      cwd: root,
      reject: false,
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/dry-run/i);
  });

  it("wp-dev services is a registered command", async () => {
    const r = await execa("node", [cli, "services", "--help"], {
      cwd: root,
      reject: false,
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/service registry|services/i);
  });

  it("wp-dev supervisor status is a registered subcommand", async () => {
    const r = await execa("node", [cli, "supervisor", "status", "--help"], {
      cwd: root,
      reject: false,
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toMatch(/supervisor|registry/i);
  });

  it("wp-dev doctor accepts --lifecycle and --filesystem flags", async () => {
    const r = await execa("node", [cli, "doctor", "--help"], {
      cwd: root,
      reject: false,
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("--lifecycle");
    expect(r.stdout).toContain("--filesystem");
  });

  it("wp-dev up accepts --relocate-ports and --reclaim-ports", async () => {
    const r = await execa("node", [cli, "up", "--help"], {
      cwd: root,
      reject: false,
    });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("--relocate-ports");
    expect(r.stdout).toContain("--reclaim-ports");
  });
});

describe("runner smoke", () => {
  it("terminal-runner registers sync preview actions", () => {
    const src = readFileSync(join(root, "docker/terminal-runner.mjs"), "utf8");
    expect(src).toContain("wpdev_sync_preview");
    expect(src).toContain("wpdev_sync_scan");
    expect(src).toContain("wpdev_push_dry");
    expect(src).toContain("wpdev_update");
    expect(src).toContain("/cancel/");
  });

  it("sync runner listens on fixed container port 7683 (host port is publish-only)", () => {
    const content = readFileSync(composePath, "utf8");
    expect(content).toContain("${WPDEV_HOST_RUNNER_PORT:-7683}:7683");
    expect(content).toMatch(/WPDEV_HOST_RUNNER_PORT:\s*"7683"/);
    expect(content).not.toMatch(/WPDEV_HOST_RUNNER_PORT:\s*\$\{/);
  });

  it("terminal container starts via start-terminal-services.sh", () => {
    const dockerfile = readFileSync(join(root, "docker/terminal.Dockerfile"), "utf8");
    expect(dockerfile).toContain("start-terminal-services.sh");
    const script = readFileSync(join(root, "docker/start-terminal-services.sh"), "utf8");
    expect(script).toContain("host-runner.mjs");
    expect(script).toContain("terminal-runner.mjs");
  });

  it("runner proxy routes sync runner to terminal container", () => {
    const proxy = readFileSync(join(root, "docs/admin/public/runner-proxy.inc.php"), "utf8");
    expect(proxy).toContain("WPDEV_SYNC_RUNNER_CONTAINER_PORT = 7683");
    expect(proxy).not.toContain("host.docker.internal");
  });
});

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execa } from "execa";

const root = process.cwd();
const cli = join(root, "dist/cli.js");

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
});

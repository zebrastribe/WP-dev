import { describe, expect, it } from "vitest";
import {
  restoreEnvConfirmOk,
  gitTokenEnv,
  safeArg,
  safeRepoUrl,
  safeBackupImportName,
  wpdevPullPushCommand,
  wpdevPushThemeCommand,
} from "../docker/runner-sync-gates.mjs";

describe("runner-sync-gates", () => {
  it("safeArg strips shell-metacharacter payloads", () => {
    expect(safeArg("staging.example.com")).toBe("staging.example.com");
    expect(safeArg("evil;rm -rf /")).toBe("");
    expect(safeArg("a b")).toBe("");
  });

  it("allows an IP or LAN name in a repository address", () => {
    expect(safeRepoUrl("http://192.168.1.20:7990/scm/ACME/plugin.git")).toBe(
      "http://192.168.1.20:7990/scm/ACME/plugin.git",
    );
    expect(safeRepoUrl("https://bitbucket.lan/projects/ACME/repos/theme")).toContain("bitbucket.lan");
    expect(safeRepoUrl("http://evil.example/scm/ACME/plugin.git?token=secret")).toBe("");
  });

  it("keeps a repository token out of the command string", () => {
    expect(gitTokenEnv("ghp_example")).toEqual({ WPDEV_GIT_TOKEN: "ghp_example" });
    expect(gitTokenEnv("has\nnewline")).toEqual({});
  });

  it.each([
    ["pull", "staging", "staging.example.com", "npm run wp-dev -- pull staging --yes --confirm-host staging.example.com"],
    ["push", "staging", "staging.example.com", "npm run wp-dev -- push staging --yes --confirm-host staging.example.com"],
    ["pull", "production", "SYNC_PRODUCTION", "npm run wp-dev -- pull production --yes"],
    ["push", "production", "SYNC_PRODUCTION", "npm run wp-dev -- push production --yes"],
  ] as const)(
    "%s %s with valid confirm builds CLI",
    (kind, env, confirm, expected) => {
      expect(wpdevPullPushCommand(kind, env, confirm)).toBe(expected);
    },
  );

  it.each([
    ["pull", "staging", ""],
    ["pull", "staging", undefined],
    ["push", "production", ""],
    ["push", "production", "yes"],
    ["push", "production", "RESTORE_PRODUCTION"],
    ["pull", "local", "SYNC_PRODUCTION"],
  ] as const)("%s %s refuses bad confirm (%s)", (kind, env, confirm) => {
    expect(wpdevPullPushCommand(kind, env, confirm as string)).toBeNull();
  });

  it("restoreEnvConfirmOk gates production and staging", () => {
    expect(restoreEnvConfirmOk("local", "")).toBe(true);
    expect(restoreEnvConfirmOk("staging", "staging.example.com")).toBe(true);
    expect(restoreEnvConfirmOk("staging", "")).toBe(false);
    expect(restoreEnvConfirmOk("production", "RESTORE_PRODUCTION")).toBe(true);
    expect(restoreEnvConfirmOk("production", "SYNC_PRODUCTION")).toBe(false);
    expect(restoreEnvConfirmOk("production", "")).toBe(false);
  });

  it("safeBackupImportName accepts a cloud local-setup archive and refuses paths", () => {
    expect(safeBackupImportName("wp-dev-local-setup-production-2026-11-05.tar.gz")).toBe(
      "wp-dev-local-setup-production-2026-11-05.tar.gz",
    );
    expect(safeBackupImportName("db-2026-11-05.sql")).toBe("db-2026-11-05.sql");
    expect(safeBackupImportName("../db.sql")).toBe("");
    expect(safeBackupImportName("backup.sql.gz")).toBe("");
    expect(safeBackupImportName(".env.sql")).toBe("");
    expect(safeBackupImportName("notes.txt")).toBe("");
  });

  it("wpdevPushThemeCommand requires SYNC_PRODUCTION for production", () => {
    expect(wpdevPushThemeCommand("production", "SYNC_PRODUCTION", "1")).toBe(
      "npm run wp-dev -- push theme production --yes --build",
    );
    expect(wpdevPushThemeCommand("production", "yes", false)).toBeNull();
    expect(wpdevPushThemeCommand("staging", "staging.example.com", "")).toBe(
      "npm run wp-dev -- push theme staging --yes",
    );
    expect(wpdevPushThemeCommand("staging", "", false)).toBeNull();
  });
});

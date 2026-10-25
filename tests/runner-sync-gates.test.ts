import { describe, expect, it } from "vitest";
import {
  restoreEnvConfirmOk,
  safeArg,
  wpdevPullPushCommand,
  wpdevPushThemeCommand,
} from "../docker/runner-sync-gates.mjs";

describe("runner-sync-gates", () => {
  it("safeArg strips shell-metacharacter payloads", () => {
    expect(safeArg("staging.example.com")).toBe("staging.example.com");
    expect(safeArg("evil;rm -rf /")).toBe("");
    expect(safeArg("a b")).toBe("");
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

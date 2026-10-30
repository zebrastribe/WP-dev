import { describe, expect, it } from "vitest";
import {
  restoreEnvConfirmOk,
  wpdevPullPushCommand,
  wpdevPushThemeCommand,
} from "../docker/runner-sync-gates.mjs";

describe("runner sync gates", () => {
  it("wpdevPullPushCommand refuses staging without confirm host", () => {
    expect(wpdevPullPushCommand("pull", "staging", "")).toBe(null);
    expect(wpdevPullPushCommand("push", "staging", "")).toBe(null);
  });

  it("wpdevPullPushCommand refuses production without SYNC_PRODUCTION token", () => {
    expect(wpdevPullPushCommand("pull", "production", "")).toBe(null);
    expect(wpdevPullPushCommand("push", "production", "wrong")).toBe(null);
    expect(wpdevPullPushCommand("push", "production", "SYNC_PRODUCTION")).toMatch(/push production/);
  });

  it("wpdevPullPushCommand allows staging with confirm host", () => {
    const cmd = wpdevPullPushCommand("pull", "staging", "staging.example.com");
    expect(cmd).toMatch(/pull staging/);
    expect(cmd).toContain("--confirm-host staging.example.com");
  });

  it("wpdevPushThemeCommand refuses without proper confirm", () => {
    expect(wpdevPushThemeCommand("staging", "", false)).toBe(null);
    expect(wpdevPushThemeCommand("production", "", false)).toBe(null);
    expect(wpdevPushThemeCommand("production", "wrong", false)).toBe(null);
  });

  it("wpdevPushThemeCommand allows production with SYNC_PRODUCTION", () => {
    expect(wpdevPushThemeCommand("production", "SYNC_PRODUCTION", false)).toMatch(/push theme production/);
  });

  it("restoreEnvConfirmOk refuses staging without confirm", () => {
    expect(restoreEnvConfirmOk("staging", "")).toBe(false);
    expect(restoreEnvConfirmOk("staging", "staging.host")).toBe(true);
  });

  it("restoreEnvConfirmOk refuses production without RESTORE_PRODUCTION", () => {
    expect(restoreEnvConfirmOk("production", "")).toBe(false);
    expect(restoreEnvConfirmOk("production", "wrong")).toBe(false);
    expect(restoreEnvConfirmOk("production", "RESTORE_PRODUCTION")).toBe(true);
  });

  it("restoreEnvConfirmOk allows local without confirm", () => {
    expect(restoreEnvConfirmOk("local", "")).toBe(true);
  });

  it("rejects invalid env names", () => {
    expect(wpdevPullPushCommand("pull", "invalid", "")).toBe(null);
    expect(restoreEnvConfirmOk("invalid", "")).toBe(false);
  });
});

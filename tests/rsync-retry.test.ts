import { describe, expect, it, vi } from "vitest";
import {
  isTransientRsyncFailure,
  rsyncConnectionRetryDelayMs,
  runRsyncWithConnectionRetries,
} from "../src/utils/rsync-retry.js";

describe("isTransientRsyncFailure", () => {
  it("treats connection drops and SSH failures as transient", () => {
    expect(isTransientRsyncFailure(255, "ssh: Connection reset by peer")).toBe(true);
    expect(isTransientRsyncFailure(12, "rsync error: error in rsync protocol data stream")).toBe(
      true,
    );
    expect(isTransientRsyncFailure(10, "Connection timed out")).toBe(true);
    expect(isTransientRsyncFailure(30, "Timeout in data send/receive")).toBe(true);
    expect(isTransientRsyncFailure(1, "Broken pipe")).toBe(true);
    expect(isTransientRsyncFailure(null, "Connection closed by remote host")).toBe(true);
  });

  it("does not retry permission or missing-path failures", () => {
    expect(isTransientRsyncFailure(23, "mkstemp: Permission denied")).toBe(false);
    expect(isTransientRsyncFailure(23, "change_dir #1 failed: No such file or directory")).toBe(
      false,
    );
    expect(isTransientRsyncFailure(23, "recv_generator: mkdir failed: Permission denied")).toBe(
      false,
    );
    expect(isTransientRsyncFailure(0, "")).toBe(false);
  });
});

describe("rsyncConnectionRetryDelayMs", () => {
  it("backs off with a cap", () => {
    expect(rsyncConnectionRetryDelayMs(1, 1_000)).toBe(1_000);
    expect(rsyncConnectionRetryDelayMs(2, 1_000)).toBe(2_000);
    expect(rsyncConnectionRetryDelayMs(3, 1_000)).toBe(4_000);
    expect(rsyncConnectionRetryDelayMs(10, 1_000)).toBe(30_000);
  });
});

describe("runRsyncWithConnectionRetries", () => {
  it("returns immediately on success", async () => {
    const runOnce = vi.fn().mockResolvedValue({ exitCode: 0, stderr: "" });
    const result = await runRsyncWithConnectionRetries(runOnce, {
      sleep: async () => undefined,
    });
    expect(result.exitCode).toBe(0);
    expect(runOnce).toHaveBeenCalledTimes(1);
  });

  it("retries transient failures then succeeds", async () => {
    const runOnce = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 255, stderr: "Connection reset by peer" })
      .mockResolvedValueOnce({ exitCode: 12, stderr: "Broken pipe" })
      .mockResolvedValueOnce({ exitCode: 0, stderr: "" });
    const onRetry = vi.fn();
    const result = await runRsyncWithConnectionRetries(runOnce, {
      maxAttempts: 5,
      baseDelayMs: 10,
      sleep: async () => undefined,
      onRetry,
    });
    expect(result.exitCode).toBe(0);
    expect(runOnce).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it("does not retry permission failures", async () => {
    const runOnce = vi
      .fn()
      .mockResolvedValue({ exitCode: 23, stderr: "mkstemp: Permission denied" });
    const result = await runRsyncWithConnectionRetries(runOnce, {
      sleep: async () => undefined,
    });
    expect(result.exitCode).toBe(23);
    expect(runOnce).toHaveBeenCalledTimes(1);
  });

  it("stops after maxAttempts on persistent connection failure", async () => {
    const runOnce = vi
      .fn()
      .mockResolvedValue({ exitCode: 255, stderr: "Connection timed out" });
    const result = await runRsyncWithConnectionRetries(runOnce, {
      maxAttempts: 3,
      sleep: async () => undefined,
    });
    expect(result.exitCode).toBe(255);
    expect(runOnce).toHaveBeenCalledTimes(3);
  });
});

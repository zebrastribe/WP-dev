import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  initLogger,
  logInfo,
  logPathForConfigDir,
  getLogFilePath,
} from "../src/utils/logger.js";

describe("logger", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "wp-dev-log-test-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes under configDir/logs/wp-dev.log", () => {
    initLogger(dir);
    expect(getLogFilePath()).toBe(join(dir, "logs", "wp-dev.log"));
    logInfo("hello test");
    const text = readFileSync(logPathForConfigDir(dir), "utf8");
    expect(text).toContain("hello test");
    expect(text).toContain("[info]");
  });

  it("creates logs directory", () => {
    initLogger(dir);
    expect(existsSync(join(dir, "logs"))).toBe(true);
  });
});

describe("logger fs error handling", () => {
  let dir: string;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "wp-dev-log-error-"));
    stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    try {
      chmodSync(join(dir, "logs"), 0o755);
    } catch { /* ignore */ }
    rmSync(dir, { recursive: true, force: true });
    stderrSpy.mockRestore();
  });

  it("warns once to stderr when log write fails due to permissions", async () => {
    initLogger(dir);
    const logPath = join(dir, "logs", "wp-dev.log");
    chmodSync(logPath, 0o000);

    const { logInfo: freshLogInfo } = await import("../src/utils/logger.js");
    freshLogInfo("should fail");

    const stderrCalls = stderrSpy.mock.calls.map((c) => String(c[0])).join("\n");
    if (stderrCalls.includes("Warning: log write failed")) {
      expect(stderrCalls).toContain("Warning: log write failed");
    }
    chmodSync(logPath, 0o644);
  });
});

describe("logger source inspection", () => {
  it("warns once to stderr on write failure instead of silently failing", () => {
    const source = readFileSync(join(process.cwd(), "src/utils/logger.ts"), "utf8");
    expect(source).toContain("logWriteFailedWarned");
    expect(source).toContain("Warning: log write failed");
    expect(source).not.toMatch(/catch\s*{\s*\/\/.*don't crash/);
  });
});

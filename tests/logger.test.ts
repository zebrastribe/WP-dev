import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
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

describe("logger source inspection", () => {
  it("warns once to stderr on write failure instead of silently failing", () => {
    const source = readFileSync(join(process.cwd(), "src/utils/logger.ts"), "utf8");
    expect(source).toContain("logWriteFailedWarned");
    expect(source).toContain("Warning: log write failed");
    expect(source).not.toMatch(/catch\s*{\s*\/\/.*don't crash/);
  });
});

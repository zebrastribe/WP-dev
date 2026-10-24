import { describe, expect, it } from "vitest";
import {
  formatBytes,
  needForFullBackup,
  parseDfAvailableBytes,
  wrapNoSpaceError,
} from "../src/utils/disk-space.js";

describe("disk-space", () => {
  it("parseDfAvailableBytes reads Available column (KiB blocks)", () => {
    const out = [
      "Filesystem     1024-blocks      Used Available Capacity Mounted on",
      "/dev/sda1       104857600  52428800  52428800      50% /",
    ].join("\n");
    expect(parseDfAvailableBytes(out)).toBe(52428800 * 1024);
  });

  it("parseDfAvailableBytes handles wrapped filesystem lines", () => {
    const out = [
      "Filesystem     1024-blocks      Used Available Capacity Mounted on",
      "/dev/mapper/very-long-name",
      "               104857600  10000000  20000000      34% /home",
    ].join("\n");
    expect(parseDfAvailableBytes(out)).toBe(20000000 * 1024);
  });

  it("formatBytes is human readable", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toMatch(/KiB/);
    expect(formatBytes(5 * 1024 * 1024)).toMatch(/MiB/);
  });

  it("needForFullBackup applies floor and headroom", () => {
    expect(needForFullBackup(100)).toBeGreaterThanOrEqual(512 * 1024 * 1024);
    const big = 10 * 1024 * 1024 * 1024;
    expect(needForFullBackup(big)).toBeGreaterThan(big);
  });

  it("wrapNoSpaceError clarifies ENOSPC", () => {
    const err = wrapNoSpaceError(new Error("ENOSPC: no space left on device"), "backup local");
    expect(err.message).toMatch(/ran out of disk space/i);
    expect(err.message).toMatch(/backup local/);
  });
});

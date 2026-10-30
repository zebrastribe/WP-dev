import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("runner log ownership", () => {
  const terminalRunner = readFileSync(join(process.cwd(), "docker/terminal-runner.mjs"), "utf8");
  const hostRunner = readFileSync(join(process.cwd(), "docker/host-runner.mjs"), "utf8");

  it("terminal-runner imports chownSync from node:fs (not require)", () => {
    expect(terminalRunner).toMatch(/import\s+{[^}]*chownSync[^}]*}\s+from\s+["']node:fs["']/);
    expect(terminalRunner).not.toMatch(/require\s*\(\s*["']node:fs["']\s*\)/);
  });

  it("host-runner imports chownSync from node:fs (not require)", () => {
    expect(hostRunner).toMatch(/import\s+{[^}]*chownSync[^}]*}\s+from\s+["']node:fs["']/);
    expect(hostRunner).not.toMatch(/require\s*\(\s*["']node:fs["']\s*\)/);
  });

  it("terminal-runner imports statSync for checking existing ownership", () => {
    expect(terminalRunner).toMatch(/import\s+{[^}]*statSync[^}]*}\s+from\s+["']node:fs["']/);
  });

  it("host-runner imports statSync for checking existing ownership", () => {
    expect(hostRunner).toMatch(/import\s+{[^}]*statSync[^}]*}\s+from\s+["']node:fs["']/);
  });

  it("terminal-runner fixes existing root-owned logs", () => {
    expect(terminalRunner).toContain("dirStat.uid === 0");
    expect(terminalRunner).toContain("fileStat.uid === 0");
  });

  it("host-runner fixes existing root-owned logs", () => {
    expect(hostRunner).toContain("dirStat.uid === 0");
    expect(hostRunner).toContain("fileStat.uid === 0");
  });

  it("runners log chown failures instead of swallowing them", () => {
    expect(terminalRunner).toContain("chown failed:");
    expect(hostRunner).toContain("chown failed:");
    expect(terminalRunner).not.toMatch(/catch\s*{\s*\/\/\s*ignore chown failures\s*}/);
    expect(hostRunner).not.toMatch(/catch\s*{\s*\/\/\s*ignore chown failures\s*}/);
  });
});

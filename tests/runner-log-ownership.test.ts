import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("runner log ownership", () => {
  const terminalRunner = readFileSync(join(process.cwd(), "docker/terminal-runner.mjs"), "utf8");
  const hostRunner = readFileSync(join(process.cwd(), "docker/host-runner.mjs"), "utf8");

  describe("imports", () => {
    it("terminal-runner imports chownSync and statSync from node:fs", () => {
      expect(terminalRunner).toMatch(/import\s+{[^}]*chownSync[^}]*}\s+from\s+["']node:fs["']/);
      expect(terminalRunner).toMatch(/import\s+{[^}]*statSync[^}]*}\s+from\s+["']node:fs["']/);
    });

    it("host-runner imports chownSync and statSync from node:fs", () => {
      expect(hostRunner).toMatch(/import\s+{[^}]*chownSync[^}]*}\s+from\s+["']node:fs["']/);
      expect(hostRunner).toMatch(/import\s+{[^}]*statSync[^}]*}\s+from\s+["']node:fs["']/);
    });

    it("runners do not use require() for node:fs", () => {
      expect(terminalRunner).not.toMatch(/require\s*\(\s*["']node:fs["']\s*\)/);
      expect(hostRunner).not.toMatch(/require\s*\(\s*["']node:fs["']\s*\)/);
    });

    it("terminal-runner imports log utils from shared module", () => {
      expect(terminalRunner).toMatch(/import\s+{[^}]*stripControlChars[^}]*}\s+from\s+["'].\/runner-log-utils\.mjs["']/);
      expect(terminalRunner).toMatch(/import\s+{[^}]*sanitizeArgsForLog[^}]*}\s+from\s+["'].\/runner-log-utils\.mjs["']/);
    });

    it("host-runner imports log utils from shared module", () => {
      expect(hostRunner).toMatch(/import\s+{[^}]*stripControlChars[^}]*}\s+from\s+["'].\/runner-log-utils\.mjs["']/);
      expect(hostRunner).toMatch(/import\s+{[^}]*sanitizeArgsForLog[^}]*}\s+from\s+["'].\/runner-log-utils\.mjs["']/);
    });
  });

  describe("ownership fallback", () => {
    it("terminal-runner has resolveHostOwnership function", () => {
      expect(terminalRunner).toContain("function resolveHostOwnership()");
    });

    it("host-runner has resolveHostOwnership function", () => {
      expect(hostRunner).toContain("function resolveHostOwnership()");
    });

    it("resolveHostOwnership falls back to workdir stat when env vars unset", () => {
      expect(terminalRunner).toMatch(/statSync\s*\(\s*WORKDIR\s*\)/);
      expect(hostRunner).toMatch(/statSync\s*\(\s*WORKDIR\s*\)/);
    });
  });

  describe("fix existing root-owned files", () => {
    it("terminal-runner checks and fixes existing root-owned logs", () => {
      expect(terminalRunner).toContain("dirStat.uid === 0");
      expect(terminalRunner).toContain("fileStat.uid === 0");
    });

    it("host-runner checks and fixes existing root-owned logs", () => {
      expect(hostRunner).toContain("dirStat.uid === 0");
      expect(hostRunner).toContain("fileStat.uid === 0");
    });
  });

  describe("error reporting", () => {
    it("runners log chown failures to stderr", () => {
      expect(terminalRunner).toContain("chown failed:");
      expect(hostRunner).toContain("chown failed:");
    });
  });
});

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("runner log injection prevention", () => {
  describe("stripControlChars", () => {
    const stripControlChars = (s: string): string => {
      if (typeof s !== "string") return String(s);
      return s.replace(/[\x00-\x1f\x7f]/g, "");
    };

    it("strips newlines from action", () => {
      expect(stripControlChars("wpdev_pull\nmalicious")).toBe("wpdev_pullmalicious");
    });

    it("strips carriage returns from action", () => {
      expect(stripControlChars("wpdev_pull\rmalicious")).toBe("wpdev_pullmalicious");
    });

    it("strips mixed control chars", () => {
      expect(stripControlChars("a\nb\rc\td\0e")).toBe("abcde");
    });

    it("preserves normal strings", () => {
      expect(stripControlChars("staging.example.com")).toBe("staging.example.com");
    });

    it("handles empty string", () => {
      expect(stripControlChars("")).toBe("");
    });
  });

  describe("sanitizeArgsForLog with control chars", () => {
    const safeArg = (v: string | undefined): string => {
      if (typeof v !== "string") return "";
      if (/[;|&`$(){}[\]<>\\'"!#%^*~?\s\n\r]/.test(v)) return "";
      return v;
    };

    const stripControlChars = (s: string): string => {
      if (typeof s !== "string") return String(s);
      return s.replace(/[\x00-\x1f\x7f]/g, "");
    };

    const sanitizeArgsForLog = (args: Record<string, unknown> | undefined): string => {
      if (!args || typeof args !== "object") return "{}";
      const safe: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(args)) {
        const safeKey = stripControlChars(k);
        if (typeof v === "string") {
          safe[safeKey] = safeArg(v) || `[unsafe:${v.length}chars]`;
        } else {
          safe[safeKey] = v;
        }
      }
      return JSON.stringify(safe);
    };

    it("strips control chars from arg keys", () => {
      const result = sanitizeArgsForLog({ "env\n": "staging" });
      expect(result).toContain('"env"');
      expect(result).not.toContain("\\n");
    });

    it("marks values with newlines as unsafe", () => {
      const result = sanitizeArgsForLog({ env: "staging\nmalicious" });
      expect(result).toContain("[unsafe:");
    });

    it("marks values with carriage returns as unsafe", () => {
      const result = sanitizeArgsForLog({ env: "staging\rmalicious" });
      expect(result).toContain("[unsafe:");
    });

    it("preserves safe values", () => {
      const result = sanitizeArgsForLog({ env: "staging" });
      expect(result).toBe('{"env":"staging"}');
    });
  });

  describe("describeRefusal messages", () => {
    const safeArg = (v: string | undefined): string => {
      if (typeof v !== "string") return "";
      if (/[;|&`$(){}[\]<>\\'"!#%^*~?\s\n\r]/.test(v)) return "";
      return v;
    };

    const describeRefusal = (action: string, args: { env?: string; confirm?: string }) => {
      const safeAction = safeArg(action);
      const env = safeArg(args?.env);

      if (safeAction === "backup_list" || safeAction === "backup_create") {
        if (!["local", "staging", "production"].includes(env)) {
          return `invalid env for ${safeAction} (got ${env ? env.length : 0} safe chars)`;
        }
        return "invalid args";
      }
      if (!safeAction) return `invalid action (got ${typeof action === "string" ? action.length : 0} chars, none safe)`;
      return `unknown action ${safeAction}`;
    };

    it("reports correct error for backup_list with invalid env", () => {
      const result = describeRefusal("backup_list", { env: "invalid" });
      expect(result).toContain("invalid env for backup_list");
    });

    it("reports correct error for backup_create with empty env", () => {
      const result = describeRefusal("backup_create", { env: "" });
      expect(result).toContain("invalid env for backup_create");
    });

    it("reports 0 safe chars for env with control chars", () => {
      const result = describeRefusal("backup_list", { env: "local\n" });
      expect(result).toContain("got 0 safe chars");
    });

    it("reports unknown action for truly unknown actions", () => {
      const result = describeRefusal("not_a_real_action", { env: "local" });
      expect(result).toBe("unknown action not_a_real_action");
    });

    it("reports invalid action for actions with control chars", () => {
      const result = describeRefusal("backup_list\n", { env: "local" });
      expect(result).toContain("invalid action");
    });
  });
});

import { describe, expect, it } from "vitest";
import {
  stripControlChars,
  sanitizeArgsForLog,
  describeRefusal,
} from "../docker/runner-log-utils.mjs";
import { safeArg } from "../docker/runner-sync-gates.mjs";

describe("runner log injection prevention (real functions)", () => {
  describe("stripControlChars", () => {
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

    it("handles non-string input", () => {
      expect(stripControlChars(123 as unknown as string)).toBe("123");
      expect(stripControlChars(null as unknown as string)).toBe("null");
    });
  });

  describe("sanitizeArgsForLog", () => {
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

    it("handles empty/null args", () => {
      expect(sanitizeArgsForLog(null as never)).toBe("{}");
      expect(sanitizeArgsForLog(undefined as never)).toBe("{}");
      expect(sanitizeArgsForLog({})).toBe("{}");
    });

    it("handles non-string values", () => {
      const result = sanitizeArgsForLog({ count: 42 as unknown as string });
      expect(result).toContain('"count":42');
    });
  });

  describe("describeRefusal", () => {
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

    it("accepts valid env for backup actions", () => {
      expect(describeRefusal("backup_list", { env: "local" })).toBe("invalid args");
      expect(describeRefusal("backup_list", { env: "staging" })).toBe("invalid args");
      expect(describeRefusal("backup_list", { env: "production" })).toBe("invalid args");
    });
  });

  describe("safeArg edge cases with injection payloads", () => {
    it("rejects newlines", () => {
      expect(safeArg("value\ninjection")).toBe("");
    });

    it("rejects carriage returns", () => {
      expect(safeArg("value\rinjection")).toBe("");
    });

    it("rejects spaces", () => {
      expect(safeArg("value injection")).toBe("");
    });

    it("rejects shell metacharacters", () => {
      expect(safeArg("value;injection")).toBe("");
      expect(safeArg("value|injection")).toBe("");
      expect(safeArg("value&injection")).toBe("");
      expect(safeArg("value`injection")).toBe("");
      expect(safeArg("value$injection")).toBe("");
    });

    it("accepts safe hostnames and paths", () => {
      expect(safeArg("staging.example.com")).toBe("staging.example.com");
      expect(safeArg("/home/user/.wp-dev/backups")).toBe("/home/user/.wp-dev/backups");
      expect(safeArg("user@host:path")).toBe("user@host:path");
    });
  });
});

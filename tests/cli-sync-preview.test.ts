import { describe, expect, it } from "vitest";
import { parseSyncDirection } from "../src/commands/sync-preview.js";
import {
  groupPathsByTopFolder,
  parseRsyncItemizeOutput,
  summarizeChangePaths,
} from "../src/services/sync-preview-parse.js";

describe("CLI sync-preview args", () => {
  it("parseSyncDirection accepts push and pull", () => {
    expect(parseSyncDirection("push")).toBe("push");
    expect(parseSyncDirection("pull")).toBe("pull");
  });

  it("parseSyncDirection rejects invalid values", () => {
    expect(() => parseSyncDirection("sync")).toThrow(/Invalid direction/);
    expect(() => parseSyncDirection("")).toThrow();
  });
});

describe("sync-preview-parse edge cases", () => {
  it("returns empty buckets for blank output", () => {
    const parsed = parseRsyncItemizeOutput("", "push");
    expect(parsed.totalCount).toBe(0);
    expect(parsed.added).toHaveLength(0);
  });

  it("ignores unrelated rsync status lines", () => {
    const out = ["sent 123 bytes", "total size is 456"].join("\n");
    const parsed = parseRsyncItemizeOutput(out, "push");
    expect(parsed.totalCount).toBe(0);
  });

  it("parses deleted and other marker lines", () => {
    const out = [
      "*deleting   wp-content/cache/old.php",
      "*some message about transfer",
      ">f..t...... wp-content/themes/x/style.css",
    ].join("\n");
    const parsed = parseRsyncItemizeOutput(out, "push");
    expect(parsed.deleted).toContain("wp-content/cache/old.php");
    expect(parsed.other.length).toBeGreaterThan(0);
    expect(parsed.updated).toContain("wp-content/themes/x/style.css");
  });

  it("summarizeChangePaths merges buckets with limit", () => {
    const parsed = parseRsyncItemizeOutput(
      ">f+++++++++ a.txt\n>f+++++++++ b.txt\n>fcst...... c.txt",
      "push",
    );
    expect(summarizeChangePaths(parsed, 2)).toEqual(["a.txt", "b.txt"]);
  });

  it("groupPathsByTopFolder aggregates counts", () => {
    const groups = groupPathsByTopFolder([
      "wp-content/themes/a/style.css",
      "wp-content/plugins/b/b.php",
      "wp-content/plugins/c/c.php",
    ]);
    expect(groups["wp-content"]).toBe(3);
  });

  it("respects MAX_PATHS truncation flag", () => {
    const added = Array.from({ length: 300 }, (_, i) => `>f+++++++++ add-${i}.txt`);
    const updated = Array.from({ length: 300 }, (_, i) => `>fcst...... upd-${i}.txt`);
    const parsed = parseRsyncItemizeOutput([...added, ...updated].join("\n"), "push");
    expect(parsed.truncated).toBe(true);
    expect(parsed.totalCount).toBeGreaterThan(500);
  });
});

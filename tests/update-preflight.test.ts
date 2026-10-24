import { describe, expect, it } from "vitest";
import {
  collectUpdatePreflight,
  formatUpdatePreflight,
  UPDATE_BACKUP_HINTS,
} from "../src/services/update-preflight.js";

describe("update preflight", () => {
  it("collectUpdatePreflight runs on this repository", async () => {
    const preflight = await collectUpdatePreflight(process.cwd());
    expect(preflight.isGitRepo).toBe(true);
    // Upstream is optional (CI PR checkouts / local branches may have none).
    if (preflight.upstream) {
      expect(preflight.upstream.length).toBeGreaterThan(0);
    } else {
      expect(
        preflight.warnings.some((w) => w.includes("No upstream tracking branch")),
      ).toBe(true);
    }
    expect(formatUpdatePreflight(preflight)).toContain("Pre-flight check:");
  });

  it("formatUpdatePreflight mentions backup hints", () => {
    const text = formatUpdatePreflight({
      isGitRepo: true,
      upstream: "origin/main",
      dirtyCount: 2,
      untrackedCount: 1,
      commitsAhead: 3,
      commitsBehind: 0,
      forkWorkflowRecommended: true,
      warnings: ["example warning"],
    });
    expect(text).toContain("Fork detected");
    expect(text).toContain("example warning");
    expect(UPDATE_BACKUP_HINTS.some((h) => text.includes(h.split(" ")[0]!))).toBe(true);
  });
});

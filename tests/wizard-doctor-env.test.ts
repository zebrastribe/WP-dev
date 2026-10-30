import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Wizard doctor buttons", () => {
  const src = readFileSync(join("docs/admin/src/Wizard.tsx"), "utf8");

  it("Live SSH (production) panel runs doctor production, not staging", () => {
    const liveStart = src.indexOf("{step === 1 && (");
    const stagingStart = src.indexOf("{step === STAGING_STEP && (");
    expect(liveStart).toBeGreaterThan(0);
    expect(stagingStart).toBeGreaterThan(liveStart);
    const livePanel = src.slice(liveStart, stagingStart);
    expect(livePanel).toContain("doctor production --http");
    expect(livePanel).toContain('env: "production"');
    expect(livePanel).toContain("Full doctor (production)");
    expect(livePanel).not.toContain("doctor staging --http");
  });

  it("Staging panel still runs doctor staging", () => {
    const stagingStart = src.indexOf("{step === STAGING_STEP && (");
    const next = src.indexOf("{step === 3 && (", stagingStart);
    const stagingPanel = src.slice(stagingStart, next > 0 ? next : undefined);
    expect(stagingPanel).toContain("doctor staging --http");
    expect(stagingPanel).toContain('env: "staging"');
  });
});

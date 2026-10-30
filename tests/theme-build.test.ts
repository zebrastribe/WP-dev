import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("theme build chown safety", () => {
  it("theme-build.ts uses finally blocks for chown after npm ci and npm run production", () => {
    const src = readFileSync(join(process.cwd(), "src/commands/theme-build.ts"), "utf8");

    expect(src).toContain('await execa("npm", ["ci"]');
    expect(src).toContain('await execa("npm", ["run", "production"]');
    expect(src).toContain("} finally {");
    expect(src).toContain("await chownThemeBuildArtifacts");

    const finallyCount = (src.match(/\} finally \{/g) || []).length;
    expect(finallyCount).toBeGreaterThanOrEqual(2);

    const chownCallsInFinally = (src.match(/finally \{[\s\S]*?chownThemeBuildArtifacts/g) || []).length;
    expect(chownCallsInFinally).toBeGreaterThanOrEqual(2);
  });

  it("chownThemeBuildArtifacts targets node_modules and vendor", () => {
    const src = readFileSync(join(process.cwd(), "src/commands/theme-build.ts"), "utf8");
    expect(src).toContain('["node_modules", "vendor"]');
    expect(src).toContain('await execa("chown"');
    expect(src).toContain("resolveHostIdentity");
  });
});

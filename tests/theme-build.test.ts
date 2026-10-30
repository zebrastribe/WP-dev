import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("theme-build chown", () => {
  const source = readFileSync(join(process.cwd(), "src/commands/theme-build.ts"), "utf8");

  it("chowns build artifacts in finally blocks after npm ci", () => {
    expect(source).toContain("chownThemeBuildArtifacts");
    const npmCiSection = source.slice(
      source.indexOf('logInfo("theme build: npm ci")'),
      source.indexOf('logInfo("theme build: npm run production")'),
    );
    expect(npmCiSection).toContain("finally");
    expect(npmCiSection).toContain("chownThemeBuildArtifacts");
  });

  it("chowns build artifacts in finally blocks after npm run production", () => {
    const productionStart = source.indexOf('logInfo("theme build: npm run production")');
    const productionSection = source.slice(
      productionStart,
      source.lastIndexOf("const check = checkThemeBuildArtifacts"),
    );
    expect(productionSection).toContain("finally");
    expect(productionSection).toContain("chownThemeBuildArtifacts");
  });

  it("chowns node_modules, vendor, and build output directories", () => {
    const chownFn = source.slice(
      source.indexOf("async function chownThemeBuildArtifacts"),
      source.indexOf("export async function cmdThemeBuild"),
    );
    expect(chownFn).toContain('"node_modules"');
    expect(chownFn).toContain('"vendor"');
    expect(chownFn).toContain('"dist"');
    expect(chownFn).toContain('"build"');
    expect(chownFn).toContain('"public"');
  });

  it("uses resolveHostIdentity for uid:gid", () => {
    expect(source).toContain("resolveHostIdentity");
    const chownFn = source.slice(
      source.indexOf("async function chownThemeBuildArtifacts"),
      source.indexOf("export async function cmdThemeBuild"),
    );
    expect(chownFn).toContain("uid");
    expect(chownFn).toContain("gid");
    expect(chownFn).toContain('`${uid}:${gid}`');
  });
});

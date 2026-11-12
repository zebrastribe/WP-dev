import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { WpDevConfig } from "../src/config/schema.js";
import { componentFromFields, findLocalComponent, planLocalDeploy, readDeployedShas, writeDeployedSha } from "../src/services/deploy-plan.js";

const component = {
  target: "plugin" as const,
  slug: "acme",
  provider: "github" as const,
  owner: "acme",
  name: "plugin",
  branch: "release",
  subdirectory: "",
};

const config = { components: [component] } as WpDevConfig;

describe("local repository deploy plan", () => {
  it("uses the saved branch tip for a normal deploy", () => {
    const plan = planLocalDeploy({
      component,
      role: "staging",
      promote: false,
      branchTip: "c".repeat(40),
      recorded: {},
    });
    expect(plan).toEqual({ sha: "c".repeat(40), source: "repository" });
  });

  it("promotes the staging commit that was recorded on this computer", () => {
    const plan = planLocalDeploy({
      component,
      role: "production",
      promote: true,
      branchTip: "d".repeat(40),
      recorded: { staging: "a".repeat(40) },
    });
    expect(plan.sha).toBe("a".repeat(40));
  });

  it("refuses promotion when staging has not been deployed", () => {
    expect(() =>
      planLocalDeploy({
        component,
        role: "production",
        promote: true,
        recorded: {},
      }),
    ).toThrow(/no recorded commit/);
  });

  it("uses the branch the repository returned", () => {
    const row = componentFromFields({
      url: "https://github.com/acme/plugin",
      branch: "customer-beta",
      target: "plugin",
      slug: "acme",
    });
    expect(row.branch).toBe("customer-beta");
    expect(row.owner).toBe("acme");
    expect(row.name).toBe("plugin");
  });

  it("finds a component and remembers the deployed commit", () => {
    expect(findLocalComponent(config, "plugin", "acme").branch).toBe("release");
    const dir = mkdtempSync(join(tmpdir(), "wpdev-deploy-"));
    writeDeployedSha(dir, "plugin", "acme", "staging", "a".repeat(40));
    expect(readDeployedShas(dir, "plugin", "acme").staging).toBe("a".repeat(40));
    const raw = readFileSync(join(dir, ".wp-dev", "deployed.json"), "utf8");
    expect(raw).toContain("a".repeat(40));
    expect(raw).not.toContain("PRIVATE");
  });
});

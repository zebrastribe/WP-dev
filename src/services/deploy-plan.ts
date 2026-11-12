import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertBranchName, assertSubdirectory, parseRepositoryUrl, pinnedSha, promotionSha, type ComponentRepoConfig } from "@wpdev/sync-engine";
import type { WpDevConfig } from "../config/schema.js";

export type LocalComponent = NonNullable<WpDevConfig["components"]>[number];

export type DeployedShas = Partial<Record<"staging" | "production", string>>;

export function componentKey(target: string, slug: string): string {
  return `${target}:${slug}`;
}

/** A component typed in the Update form. The branch is one the repository returned. */
export function componentFromFields(input: {
  url: string;
  branch: string;
  target: "core" | "plugin" | "theme";
  slug: string;
  subdirectory?: string;
}): LocalComponent {
  const ref = parseRepositoryUrl(input.url);
  return {
    target: input.target,
    slug: input.target === "core" ? "" : input.slug.trim(),
    provider: ref.provider,
    owner: ref.owner,
    name: ref.name,
    branch: assertBranchName(input.branch),
    subdirectory: assertSubdirectory(input.subdirectory ?? ""),
  };
}

export function findLocalComponent(
  config: WpDevConfig,
  target: "core" | "plugin" | "theme",
  slug: string,
): LocalComponent {
  const found = (config.components ?? []).find((row) => row.target === target && row.slug === (target === "core" ? "" : slug));
  if (!found) {
    throw new Error("This project has no repository for that component. Use a package or file update, or add it under components.");
  }
  return found;
}

export function readDeployedShas(configDir: string, target: string, slug: string): DeployedShas {
  try {
    const raw = JSON.parse(readFileSync(join(configDir, ".wp-dev", "deployed.json"), "utf8")) as Record<string, DeployedShas>;
    return raw[componentKey(target, slug)] ?? {};
  } catch {
    return {};
  }
}

export function writeDeployedSha(
  configDir: string,
  target: string,
  slug: string,
  role: "staging" | "production",
  sha: string,
): void {
  const file = join(configDir, ".wp-dev", "deployed.json");
  let all: Record<string, DeployedShas> = {};
  try {
    all = JSON.parse(readFileSync(file, "utf8")) as Record<string, DeployedShas>;
  } catch {
    all = {};
  }
  const key = componentKey(target, slug);
  all[key] = { ...all[key], [role]: sha };
  mkdirSync(join(configDir, ".wp-dev"), { recursive: true });
  writeFileSync(file, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 });
}

function asConfig(component: LocalComponent, recorded: DeployedShas): ComponentRepoConfig {
  const binding = {
    provider: component.provider,
    owner: component.owner,
    name: component.name,
    branch: component.branch,
    subdirectory: component.subdirectory,
  };
  return {
    target: component.target,
    slug: component.target === "core" ? "" : component.slug,
    staging: { ...binding, deployedSha: recorded.staging ?? null },
    production: { ...binding, deployedSha: recorded.production ?? null },
  };
}

/** Choose the commit for a Local repository deploy. Package updates do not call this. */
export function planLocalDeploy(input: {
  component: LocalComponent;
  role: "staging" | "production";
  promote: boolean;
  resolvedSha?: string | null;
  branchTip?: string | null;
  recorded: DeployedShas;
}): { sha: string; source: "repository" } {
  if (input.promote) {
    if (input.role !== "production") throw new Error("Promote sends the Staging commit to Production.");
    return { sha: promotionSha(asConfig(input.component, input.recorded)), source: "repository" };
  }
  return { sha: pinnedSha({ resolvedSha: input.resolvedSha, branchTip: input.branchTip }), source: "repository" };
}

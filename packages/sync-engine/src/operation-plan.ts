/**
 * Shared operation plan for Local and Cloud.
 * Package updates and file sync stay available when a repository is connected.
 * A repository deploy uses the commit chosen here, not a branch name resolved later.
 */

import { createHash } from "node:crypto";
import type { ComponentRepoConfig, EnvBinding, RepoComponentTarget, RepoEnv } from "./repo-source.js";
import { assertCommitSha, componentInstallRel } from "./repo-source.js";
import { posixShellQuote } from "./shell-quote.js";
import { RECOMMENDED_PUSH_EXCLUDES, SAFE_SYNC_EXCLUDES } from "./sync-excludes.js";

export type UpdateSource = "package" | "files" | "repository";
export type DatabaseProfile = "full" | "content";
export type RestoreScope = "database" | "files" | "full";
export type BackupPartKind = "database" | "files";

export type BackupPart = {
  kind: BackupPartKind;
  sha256: string;
  bytes: number;
};

export type BackupManifest = {
  environment: string;
  createdAt: string;
  parts: BackupPart[];
  componentShas: { target: string; slug: string; sha: string }[];
};

/** Package and file updates always exist. Repository is added only when one is saved. */
export function updateSources(hasRepository: boolean): UpdateSource[] {
  return hasRepository ? ["package", "files", "repository"] : ["package", "files"];
}

export function environmentPermission(role: "staging" | "production"): string {
  return role === "production" ? "env.deploy.production" : "env.deploy.staging";
}

export function operationNeedsEnvironmentPermission(type: string, updateTarget?: string): boolean {
  if (type === "doctor" || type === "backup") return false;
  if (type === "update" && (updateTarget === "check" || updateTarget === "php_show")) return false;
  return type === "push" || type === "pull" || type === "restore" || type === "update" || type === "repo_deploy";
}

/**
 * Before the env permission exists in the catalog, job.create still allows the operation.
 * After the catalog is seeded, the environment permission is required.
 */
export function deployAllowed(input: {
  envPermExists: boolean;
  hasEnvPerm: boolean;
  hasJobCreate: boolean;
}): boolean {
  if (!input.envPermExists) return input.hasJobCreate;
  return input.hasEnvPerm;
}

export function environmentLockKey(parts: { orgId: string; siteId: string; role: string }): string {
  return `wpdev-env:${parts.orgId}:${parts.siteId}:${parts.role}`;
}

export function sharedRsyncExcludeArgs(extra: readonly string[] = []): string[] {
  const patterns = [
    ...SAFE_SYNC_EXCLUDES,
    RECOMMENDED_PUSH_EXCLUDES["node-modules"].pattern,
    RECOMMENDED_PUSH_EXCLUDES["debug-log"].pattern,
    RECOMMENDED_PUSH_EXCLUDES["upgrade-temp"].pattern,
  ];
  return [...patterns, ...extra].flatMap((pattern) => ["--exclude", pattern]);
}

export function gitOwnedPaths(configs: readonly ComponentRepoConfig[], role: RepoEnv): string[] {
  const paths: string[] = [];
  for (const config of configs) {
    if (!config[role]) continue;
    if (config.target === "core") {
      paths.push("wp-admin", "wp-includes");
      continue;
    }
    paths.push(componentInstallRel(config.target, config.slug));
  }
  return paths;
}

export function rsyncArgsForSync(input: {
  gitOwnedPaths?: readonly string[];
  copyGitPaths?: boolean;
  extraExcludes?: readonly string[];
}): string[] {
  const owned = input.copyGitPaths ? [] : (input.gitOwnedPaths ?? []);
  const exclude = sharedRsyncExcludeArgs([...(input.extraExcludes ?? []), ...owned]);
  return ["-az", ...exclude];
}

/** Remove only the paths the user confirmed. Never a blanket rsync --delete. */
export function confirmedDeleteCommand(wpPath: string, paths: readonly string[]): string | null {
  const root = wpPath.replace(/\/$/, "");
  if (!root.startsWith("/") || root.includes("..")) return null;
  const safe = paths.filter(
    (path) =>
      path.length > 0 &&
      !path.startsWith("/") &&
      !path.startsWith("-") &&
      !path.includes("\\") &&
      !path.includes("\0") &&
      !path.split("/").some((part) => part === "" || part === "." || part === ".."),
  );
  if (safe.length === 0) return null;
  const quoted = safe.map((path) => posixShellQuote(`${root}/${path}`));
  return `rm -f -- ${quoted.join(" ")}`;
}

/** Refuse a live delete list that contains a path the user did not confirm. */
export function assertDeletionsConfirmed(liveDeleted: readonly string[], confirmed: readonly string[]): void {
  const allowed = new Set(confirmed);
  const extra = liveDeleted.filter((path) => !allowed.has(path));
  if (extra.length > 0) {
    throw new Error(`These deletions were not confirmed: ${extra.slice(0, 8).join(", ")}`);
  }
}

export function searchReplaceWpArgs(from: string, to: string): string[] {
  return ["search-replace", from, to, "--precise", "--all-tables-with-prefix", "--skip-columns=guid"];
}

export function searchReplaceShell(wpPath: string, from: string, to: string): string {
  const args = searchReplaceWpArgs(from, to).map((arg) => posixShellQuote(arg)).join(" ");
  return `wp --path=${posixShellQuote(wpPath)} ${args}`;
}

/** Runtime rows removed only for the opt-in content profile. Prefix is the WordPress table prefix. */
export function contentProfileSql(prefix: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(prefix)) {
    throw new Error("The table prefix cannot be used in a cleanup statement.");
  }
  return [
    `DELETE FROM ${prefix}usermeta WHERE meta_key = 'session_tokens'`,
    `DELETE FROM ${prefix}options WHERE option_name LIKE '\\_transient\\_%' OR option_name LIKE '\\_site\\_transient\\_%'`,
  ].join("; ");
}

export function databaseCleanupSql(profile: DatabaseProfile, prefix: string): string | null {
  if (profile === "full") return null;
  return contentProfileSql(prefix);
}

export function sameRepository(a: EnvBinding, b: EnvBinding): boolean {
  return (
    a.provider === b.provider &&
    a.owner === b.owner &&
    a.name === b.name &&
    a.subdirectory === b.subdirectory &&
    (a.origin ?? "") === (b.origin ?? "")
  );
}

/** Promote the commit recorded on Staging. Does not look up the branch tip. */
export function promotionSha(config: ComponentRepoConfig): string {
  const staging = config.staging;
  const production = config.production;
  if (!staging?.deployedSha) throw new Error("Staging has no recorded commit to promote.");
  if (!production) throw new Error("Choose a branch for production first.");
  if (!sameRepository(staging, production)) {
    throw new Error("Staging and Production use different repositories.");
  }
  return assertCommitSha(staging.deployedSha);
}

/** The commit stored on the job wins. The branch tip is only the fallback for a job that has no pin. */
export function pinnedSha(input: { resolvedSha?: string | null; branchTip?: string | null }): string {
  if (input.resolvedSha) return assertCommitSha(input.resolvedSha);
  if (input.branchTip) return assertCommitSha(input.branchTip);
  throw new Error("Choose a commit to deploy.");
}

export function headerShaFromOutput(stdout: string): string | null {
  const match = /WPDEV_REPO_HEADER_SHA ([a-f0-9]{64})/i.exec(stdout);
  return match ? match[1]!.toLowerCase() : null;
}

export function headerMatches(installed: string | null, expected: string | null): boolean {
  if (!installed || !expected) return false;
  return installed.toLowerCase() === expected.toLowerCase();
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

export function scopeFingerprint(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function idempotencyDecision(existingHash: string | null, nextHash: string): "reuse" | "conflict" {
  if (!existingHash || existingHash === nextHash) return "reuse";
  return "conflict";
}

export function buildBackupManifest(input: {
  environment: string;
  createdAt: string;
  parts: BackupPart[];
  componentShas?: { target: string; slug: string; sha: string }[];
}): BackupManifest {
  return {
    environment: input.environment,
    createdAt: input.createdAt,
    parts: input.parts.map((part) => ({ ...part })),
    componentShas: input.componentShas ?? [],
  };
}

export function restoreParts(manifest: BackupManifest, scope: RestoreScope): BackupPart[] {
  const database = manifest.parts.find((part) => part.kind === "database");
  const files = manifest.parts.find((part) => part.kind === "files");
  if (scope === "database") {
    if (!database) throw new Error("This backup has no database.");
    return [database];
  }
  if (scope === "files") {
    if (!files) throw new Error("This backup has no files.");
    return [files];
  }
  if (!database || !files) {
    throw new Error("This backup does not contain both the database and the files.");
  }
  return [database, files];
}

export function driftReport(input: {
  recordedSha: string | null;
  tipSha: string | null;
  installedHash: string | null;
  expectedHash: string | null;
}): { commit: "unknown" | "match" | "behind"; files: "unknown" | "match" | "differ" } {
  let commit: "unknown" | "match" | "behind" = "unknown";
  if (input.recordedSha && input.tipSha) {
    commit = input.recordedSha.toLowerCase() === input.tipSha.toLowerCase() ? "match" : "behind";
  }
  let files: "unknown" | "match" | "differ" = "unknown";
  if (input.installedHash && input.expectedHash) {
    files = input.installedHash.toLowerCase() === input.expectedHash.toLowerCase() ? "match" : "differ";
  }
  return { commit, files };
}

export function backupIsDue(lastBackupAt: string | null, intervalHours: number | null, nowMs: number): boolean {
  if (intervalHours == null || intervalHours < 1) return false;
  if (!lastBackupAt) return true;
  const last = Date.parse(lastBackupAt);
  if (Number.isNaN(last)) return true;
  return nowMs - last >= intervalHours * 3_600_000;
}

export function approvalDecision(input: {
  required: boolean;
  destination: string;
  actorId: string;
  approverId: string | null;
}): "ready" | "waiting" | "self" {
  if (!input.required || input.destination !== "production") return "ready";
  if (!input.approverId) return "waiting";
  if (input.approverId === input.actorId) return "self";
  return "ready";
}

export function parseSyncExtras(raw: unknown): {
  confirmedDeletions: string[];
  databaseProfile: DatabaseProfile;
  copyGitPaths: boolean;
  gitOwnedPaths: string[];
} {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const confirmed = Array.isArray(record.confirmedDeletions)
    ? record.confirmedDeletions.filter((item): item is string => typeof item === "string" && item.length > 0 && !item.includes(".."))
    : [];
  const owned = Array.isArray(record.gitOwnedPaths)
    ? record.gitOwnedPaths.filter((item): item is string => typeof item === "string" && item.length > 0 && !item.includes(".."))
    : [];
  return {
    confirmedDeletions: confirmed,
    databaseProfile: record.databaseProfile === "content" ? "content" : "full",
    copyGitPaths: record.copyGitPaths === true,
    gitOwnedPaths: owned,
  };
}

export function componentPathFor(target: RepoComponentTarget, slug: string): string {
  return componentInstallRel(target, slug);
}

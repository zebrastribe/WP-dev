import { execa } from "execa";
import type { RemoteEnvConfig } from "../config/schema.js";
import {
  buildPullExcludeRules,
  buildPushExcludeRules,
  collectSyncSafetyWarnings,
  pullExcludePatterns,
  pushExcludePatterns,
} from "./sync-excludes.js";
import { buildStaysLocalSummary } from "./sync-units.js";
import type { LoadedConfig } from "../config/load.js";
import { resolveFromConfigDir } from "../config/load.js";
import { getRemoteEnv, type RemoteEnvName } from "../config/schema.js";
import {
  groupPathsByTopFolder,
  parseRsyncItemizeOutput,
  summarizeChangePaths,
} from "./sync-preview-parse.js";
import { buildSshRsyncEnv } from "../utils/rsync-ssh-env.js";

export type SyncDirection = "push" | "pull";

export type SyncPreviewResult = {
  direction: SyncDirection;
  env: RemoteEnvName;
  remoteLabel: string;
  dryRun: true;
  changes: ReturnType<typeof parseRsyncItemizeOutput>;
  samplePaths: string[];
  folderSummary: Record<string, number>;
  excluded: ReturnType<typeof buildPushExcludeRules>;
  willPush: { path: string; change: "added" | "updated" | "deleted" }[];
  staysLocal: { label: string; path: string }[];
  warnings: string[];
  safetyWarnings: string[];
};

type CaptureResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

async function runRsyncCapture(args: string[]): Promise<CaptureResult> {
  const r = await execa("rsync", args, {
    reject: false,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: r.exitCode ?? null,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

async function rsyncPushCapture(
  remote: RemoteEnvConfig,
  localDir: string,
  excludes: string[],
): Promise<CaptureResult> {
  const excludeArgs = excludes.flatMap((e) => ["--exclude", e]);
  const remoteUrl = `${remote.user}@${remote.host}:${remote.path.replace(/\/$/, "")}/`;
  const args = [
    "-avzn",
    "--itemize-changes",
    ...excludeArgs,
    "--no-owner",
    "--no-group",
    "-e",
    buildSshRsyncEnv(remote),
    localDir.replace(/\/$/, "") + "/",
    remoteUrl,
  ];
  return runRsyncCapture(args);
}

async function rsyncPullCapture(
  remote: RemoteEnvConfig,
  localDir: string,
  excludes: string[],
): Promise<CaptureResult> {
  const excludeArgs = excludes.flatMap((e) => ["--exclude", e]);
  const remoteUrl = `${remote.user}@${remote.host}:${remote.path.replace(/\/$/, "")}/`;
  const args = [
    "-avzn",
    "--itemize-changes",
    ...excludeArgs,
    "--no-owner",
    "--no-group",
    "-e",
    buildSshRsyncEnv(remote),
    remoteUrl,
    localDir.replace(/\/$/, "") + "/",
  ];
  return runRsyncCapture(args);
}

export async function runSyncPreview(
  loaded: LoadedConfig,
  env: RemoteEnvName,
  direction: SyncDirection,
): Promise<SyncPreviewResult> {
  const { config, configDir } = loaded;
  const remote = getRemoteEnv(config, env);
  const localWpRoot = resolveFromConfigDir(configDir, config.local.wpRoot);
  const excludes =
    direction === "push"
      ? pushExcludePatterns(configDir, config, localWpRoot)
      : pullExcludePatterns(configDir, config);
  const excludedRules =
    direction === "push"
      ? buildPushExcludeRules(configDir, config, localWpRoot)
      : buildPullExcludeRules(configDir, config);

  const capture =
    direction === "push"
      ? await rsyncPushCapture(remote, localWpRoot, excludes)
      : await rsyncPullCapture(remote, localWpRoot, excludes);

  if (capture.exitCode !== 0) {
    const detail = [capture.stderr.trim(), capture.stdout.trim()].filter(Boolean).join("\n");
    throw new Error(
      detail.length > 0
        ? `Sync preview failed (rsync exit ${capture.exitCode}): ${detail}`
        : `Sync preview failed (rsync exit ${capture.exitCode})`,
    );
  }

  const changes = parseRsyncItemizeOutput(capture.stdout, direction);
  const allPaths = [...changes.added, ...changes.updated, ...changes.deleted];
  const warnings: string[] = [];

  if (direction === "push") {
    warnings.push(
      "Push also replaces the remote database after files sync. Deactivated dev plugins may still leave options in the DB.",
    );
    warnings.push(
      "Rsync does not delete remote files you stopped pushing — old copies may remain until removed manually.",
    );
  } else {
    warnings.push(
      "Pull overwrites the local database when run for real. A pre-pull backup is created if WordPress is already installed.",
    );
  }

  const willPush: SyncPreviewResult["willPush"] = [
    ...changes.added.map((path) => ({ path, change: "added" as const })),
    ...changes.updated.map((path) => ({ path, change: "updated" as const })),
    ...changes.deleted.map((path) => ({ path, change: "deleted" as const })),
  ].slice(0, 80);

  const staysLocal =
    direction === "push" ? buildStaysLocalSummary(config, localWpRoot) : [];

  const safetyWarnings =
    direction === "push" ? collectSyncSafetyWarnings(config, localWpRoot) : [];

  return {
    direction,
    env,
    remoteLabel: `${remote.user}@${remote.host}:${remote.path}`,
    dryRun: true,
    changes,
    samplePaths: summarizeChangePaths(changes, 12),
    folderSummary: groupPathsByTopFolder(allPaths),
    excluded: excludedRules,
    willPush,
    staysLocal,
    warnings,
    safetyWarnings,
  };
}

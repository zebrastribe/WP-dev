import type { LoadedConfig } from "../config/load.js";
import { resolveFromConfigDir } from "../config/load.js";
import type { RemoteEnvName } from "../config/schema.js";
import { getRemoteEnv } from "../config/schema.js";
import { assertHostSyncTools } from "../utils/host-prereq.js";
import { logInfo } from "../utils/logger.js";
import {
  buildPullExcludeRules,
  buildPushExcludeRules,
  detectSuggestedLocalOnlyPlugins,
  KNOWN_DEV_PLUGINS,
  RECOMMENDED_PUSH_EXCLUDES,
} from "../services/sync-excludes.js";
import { runSyncPreview, type SyncDirection } from "../services/sync-preview.js";
import { runSyncScan } from "../services/sync-scan.js";

export type SyncPreviewOptions = {
  json: boolean;
};

export type SyncScanOptions = {
  json: boolean;
};

export function parseSyncDirection(raw: string): SyncDirection {
  if (raw === "push" || raw === "pull") return raw;
  throw new Error(`Invalid direction "${raw}". Use push or pull.`);
}

export async function cmdSyncPreview(
  loaded: LoadedConfig,
  directionRaw: string,
  env: RemoteEnvName,
  options: SyncPreviewOptions,
): Promise<void> {
  const direction = parseSyncDirection(directionRaw);
  assertHostSyncTools();
  logInfo(`sync-preview ${direction} ${env}`);
  const preview = await runSyncPreview(loaded, env, direction);
  if (options.json) {
    console.log(JSON.stringify(preview, null, 2));
    return;
  }
  const remote = getRemoteEnv(loaded.config, env);
  console.error(`\nSync preview (${direction} → ${env}) — dry run, no changes\n`);
  console.error(`Remote: ${remote.user}@${remote.host}:${remote.path}`);
  console.error(
    `Files: +${preview.changes.added.length} new, ~${preview.changes.updated.length} updated, -${preview.changes.deleted.length} deleted`,
  );
  if (preview.changes.truncated) {
    console.error("(Path list truncated in preview — use --json for full buckets.)");
  }
  if (preview.samplePaths.length > 0) {
    console.error("\nSample paths:");
    for (const p of preview.samplePaths) console.error(`  ${p}`);
  }
  console.error(`\nExcluded rules (${preview.excluded.length}):`);
  for (const rule of preview.excluded.slice(0, 15)) {
    console.error(`  ${rule.pattern}  — ${rule.reason}`);
  }
  if (preview.excluded.length > 15) {
    console.error(`  … and ${preview.excluded.length - 15} more`);
  }
  for (const w of preview.warnings) console.error(`\nNote: ${w}`);
  if (preview.safetyWarnings.length > 0) {
    console.error("\nSafety:");
    for (const w of preview.safetyWarnings) console.error(`  ⚠ ${w}`);
  }
  if (preview.staysLocal.length > 0) {
    console.error(`\nStays local (${preview.staysLocal.length}):`);
    for (const item of preview.staysLocal.slice(0, 12)) {
      console.error(`  ${item.path}`);
    }
  }
}

export async function cmdSyncScan(
  loaded: LoadedConfig,
  options: SyncScanOptions,
): Promise<void> {
  logInfo("sync-scan");
  const scan = await runSyncScan(loaded);
  if (options.json) {
    console.log(JSON.stringify(scan, null, 2));
    return;
  }
  console.error("\nwp-dev sync scan\n");
  console.error(`Active theme: ${scan.activeTheme ?? "(unknown)"}`);
  console.error(`Plugins: ${scan.plugins.length}, Themes: ${scan.themes.length}`);
  if (scan.suggestions.devPlugins.length > 0) {
    console.error(`Suggested local-only plugins: ${scan.suggestions.devPlugins.join(", ")}`);
  }
  for (const t of scan.suggestions.buildThemes) {
    console.error(
      `Suggested theme rules for ${t.slug}: exclude ${t.excludeFolders.join(", ") || "(none)"}`,
    );
  }
  console.error("");
}

export async function cmdSyncRules(loaded: LoadedConfig): Promise<void> {
  const wpRoot = resolveFromConfigDir(loaded.configDir, loaded.config.local.wpRoot);
  const pushRules = buildPushExcludeRules(loaded.configDir, loaded.config, wpRoot);
  const pullRules = buildPullExcludeRules(loaded.configDir, loaded.config);
  const suggested = detectSuggestedLocalOnlyPlugins(wpRoot, loaded.config);

  console.error("\nwp-dev sync rules\n");
  console.error("Push excludes (local → remote):");
  for (const rule of pushRules) {
    console.error(`  [${rule.category}] ${rule.pattern} — ${rule.reason}`);
  }
  console.error("\nPull excludes (remote → local):");
  for (const rule of pullRules) {
    console.error(`  [${rule.category}] ${rule.pattern} — ${rule.reason}`);
  }

  const localOnly = loaded.config.sync?.localOnlyPlugins ?? [];
  if (localOnly.length > 0) {
    console.error(`\nLocal-only plugins: ${localOnly.join(", ")}`);
  }

  if (suggested.length > 0) {
    console.error(
      `\nSuggested local-only plugins (installed, not excluded yet): ${suggested
        .map((s) => KNOWN_DEV_PLUGINS[s]?.label ?? s)
        .join(", ")}`,
    );
  }

  console.error("\nRecommended toggles (push):");
  for (const [key, meta] of Object.entries(RECOMMENDED_PUSH_EXCLUDES)) {
    const on = !(loaded.config.sync?.disabledRecommended ?? []).includes(key);
    console.error(`  ${on ? "ON " : "OFF"} ${key} — ${meta.label} (${meta.pattern})`);
  }
  console.error("\nEdit via admin Sync tab or wp-dev.config.json sync section.");
  console.error("Advanced patterns: .wp-dev/sync-excludes (one rsync pattern per line)\n");
}

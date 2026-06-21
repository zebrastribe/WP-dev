import { useCallback, useEffect, useMemo, useState } from "react";
import { logAdmin } from "./adminLog";
import {
  getTerminalJobStatus,
  loadWpDevConfig,
  runTerminalAction,
  saveWpDevConfig,
  type TerminalAction,
} from "./api";
import { useAdminAuth } from "./AdminAuthProvider";
import { useRunnerSecrets } from "./useRunnerSecrets";

type RemoteEnv = "staging" | "production";
type SyncDirection = "push" | "pull";
type PluginMode = "sync" | "localOnly";
type ThemeMode = "all" | "custom" | "localOnly";

type SyncScanTheme = {
  slug: string;
  active: boolean;
  mode: ThemeMode;
  buildTheme: boolean;
  excludeFolders: string[];
  excludeFiles: string[];
  folders: string[];
  files: string[];
  recommendedExcludeFolders: string[];
  recommendedExcludeFiles: string[];
};

type SyncScan = {
  activeTheme: string | null;
  plugins: {
    slug: string;
    label: string;
    mode: PluginMode;
    isDev: boolean;
  }[];
  themes: SyncScanTheme[];
  suggestions: {
    devPlugins: string[];
    buildThemes: { slug: string; excludeFolders: string[]; excludeFiles: string[] }[];
  };
};

type SyncPreviewJson = {
  direction: SyncDirection;
  env: RemoteEnv;
  remoteLabel: string;
  changes: {
    added: string[];
    updated: string[];
    deleted: string[];
    totalCount: number;
  };
  willPush: { path: string; change: string }[];
  staysLocal: { label: string; path: string }[];
  warnings: string[];
  safetyWarnings: string[];
  folderSummary: Record<string, number>;
};

const RECOMMENDED_TOGGLES = [
  { key: "node-modules", label: "node_modules", hint: "All theme/build node_modules" },
  { key: "debug-log", label: "debug.log", hint: "wp-content/debug.log" },
  { key: "upgrade-temp", label: "upgrade temp", hint: "wp-content/upgrade" },
] as const;

function SyncHelpPanel() {
  return (
    <details className="rounded-xl border border-slate-200 bg-slate-50 text-sm dark:border-slate-700 dark:bg-slate-900/60">
      <summary className="cursor-pointer px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
        What do Sync / Local only mean?
      </summary>
      <div className="space-y-3 border-t border-slate-200 px-4 py-3 text-xs text-slate-700 dark:border-slate-700 dark:text-slate-300">
        <p>
          This tab sets rules for <strong>full site sync</strong> — files and database together
          (Push localhost → production, or Pull production → localhost).
        </p>
        <div>
          <p className="font-semibold text-slate-900 dark:text-slate-100">Plugins</p>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            <li>
              <strong>Deploy</strong> — plugin folder is included in push/pull.
            </li>
            <li>
              <strong>Local only</strong> — plugin never leaves your laptop. Use for dev tools
              (e.g. Query Monitor). Production keeps its own copy.
            </li>
          </ul>
        </div>
        <div>
          <p className="font-semibold text-slate-900 dark:text-slate-100">Themes</p>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            <li>
              <strong>All files</strong> — entire theme folder syncs (including node_modules unless
              excluded globally).
            </li>
            <li>
              <strong>Partial</strong> — only checked folders/files sync; dev folders like{" "}
              <code className="rounded bg-slate-200 px-1 dark:bg-slate-800">node_modules</code> stay
              local. Recommended for build themes.
            </li>
            <li>
              <strong>Never deploy</strong> — theme is skipped on push; production is unchanged.
              Do <em>not</em> use this for your active theme if you want to update production.
            </li>
          </ul>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-600 dark:bg-slate-950">
          <p className="font-semibold text-slate-900 dark:text-slate-100">
            Agency Starter (build theme)
          </p>
          <p className="mt-1">
            Localhost has the full source tree (Tailwind, npm,{" "}
            <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">theme/</code> compiled
            output). Production only needs the compiled theme — not Node or source files.
          </p>
          <p className="mt-2">
            For day-to-day theme work, prefer{" "}
            <strong>theme-only deploy</strong> (does not touch the database):
          </p>
          <pre className="mt-2 overflow-x-auto rounded bg-slate-100 p-2 font-mono text-[11px] dark:bg-slate-900">
            npm run wp-dev -- push theme production --build
          </pre>
          <p className="mt-2">
            That runs <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">npm run production</code>{" "}
            in the theme folder, then rsyncs the compiled{" "}
            <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">theme/</code> directory to
            production. Use full push here only when cloning an entire environment (files + DB).
          </p>
        </div>
      </div>
    </details>
  );
}

function parseJsonFromOutput<T>(output: string): T | null {
  const start = output.indexOf("{");
  if (start < 0) return null;
  try {
    return JSON.parse(output.slice(start)) as T;
  } catch {
    return null;
  }
}

function SegmentedToggle<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 p-0.5 dark:border-slate-700">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(opt.value)}
          className={`rounded-md px-2 py-1 text-[10px] font-semibold ${
            value === opt.value
              ? "bg-brand-600 text-white"
              : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function SyncTab() {
  const { authenticated, requestUnlock } = useAdminAuth();
  const { terminalAuth, runnerToken, runnerReady, runnerMessage, canRun } = useRunnerSecrets(
    "Runner not ready",
  );
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [scan, setScan] = useState<SyncScan | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [pluginFilter, setPluginFilter] = useState("");
  const [expandedThemes, setExpandedThemes] = useState<Set<string>>(new Set());
  const [env, setEnv] = useState<RemoteEnv>("staging");
  const [direction, setDirection] = useState<SyncDirection>("push");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [preview, setPreview] = useState<SyncPreviewJson | null>(null);
  const [rawOutput, setRawOutput] = useState("");
  const [saveMsg, setSaveMsg] = useState("");
  const [lastSavedJson, setLastSavedJson] = useState<string>("");

  const sync = (config?.sync as Record<string, unknown> | undefined) ?? {};
  const disabledRecommended = (sync.disabledRecommended as string[] | undefined) ?? [];
  const pluginsMap = (sync.plugins as Record<string, PluginMode> | undefined) ?? {};
  const themesMap = (sync.themes as Record<string, SyncScanTheme> | undefined) ?? {};
  const skipUploads = Boolean(sync.skipUploadsOnPush);
  const recommendationsDismissed = Boolean(sync.recommendationsDismissed);

  const runJob = useCallback(
    async (
      action: TerminalAction,
      args?: Record<string, string>,
    ): Promise<{ ok: boolean; output: string }> => {
      if (!canRun) return { ok: false, output: "Runner not ready." };
      const started = await runTerminalAction(action, args, "sync");
      if (!started.ok) return { ok: false, output: started.error };
      for (let i = 0; i < 600; i += 1) {
        const st = await getTerminalJobStatus(started.jobId, "sync");
        if (!st.ok) return { ok: false, output: st.error };
        setRawOutput(st.output || "Running…");
        if (st.status === "done") {
          return { ok: st.exitCode === 0, output: st.output };
        }
        await new Promise((r) => window.setTimeout(r, 1000));
      }
      return { ok: false, output: "Timed out." };
    },
    [canRun],
  );

  const refreshScan = useCallback(async () => {
    if (!canRun) return;
    setScanError(null);
    const r = await runJob("wpdev_sync_scan");
    if (!r.ok) {
      setScanError(r.error || "Could not scan plugins and themes. Is the host runner running?");
      return;
    }
    const parsed = parseJsonFromOutput<SyncScan>(r.output);
    if (!parsed) {
      setScanError("Scan finished but returned invalid JSON. Check command output below.");
      return;
    }
    setScan(parsed);
    if (parsed.activeTheme) {
      setExpandedThemes(new Set([parsed.activeTheme]));
    }
  }, [canRun, runJob]);

  useEffect(() => {
    void loadWpDevConfig().then((cfg) => {
      if (cfg) {
        setConfig(cfg);
        setLastSavedJson(JSON.stringify(cfg));
      }
    });
  }, []);

  useEffect(() => {
    if (canRun) void refreshScan();
  }, [canRun, refreshScan]);

  const updateSync = (patch: Record<string, unknown>) => {
    setConfig((prev) => ({
      ...(prev ?? {}),
      sync: { ...sync, ...patch },
    }));
  };

  const setPluginMode = (slug: string, mode: PluginMode) => {
    updateSync({ plugins: { ...pluginsMap, [slug]: mode } });
  };

  const getThemeConfig = (slug: string): SyncScanTheme => {
    const fromScan = scan?.themes.find((t) => t.slug === slug);
    const fromCfg = themesMap[slug] as SyncScanTheme | undefined;
    return {
      slug,
      active: fromScan?.active ?? slug === scan?.activeTheme,
      mode: (fromCfg?.mode ?? fromScan?.mode ?? "all") as ThemeMode,
      buildTheme: fromScan?.buildTheme ?? false,
      excludeFolders: fromCfg?.excludeFolders ?? fromScan?.excludeFolders ?? [],
      excludeFiles: fromCfg?.excludeFiles ?? fromScan?.excludeFiles ?? [],
      folders: fromScan?.folders ?? [],
      files: fromScan?.files ?? [],
      recommendedExcludeFolders: fromScan?.recommendedExcludeFolders ?? [],
      recommendedExcludeFiles: fromScan?.recommendedExcludeFiles ?? [],
    };
  };

  const setThemeMode = (slug: string, mode: ThemeMode) => {
    const current = getThemeConfig(slug);
    updateSync({
      themes: {
        ...themesMap,
        [slug]:
          mode === "all"
            ? { mode: "all" }
            : mode === "localOnly"
              ? { mode: "localOnly" }
              : {
                  mode: "custom",
                  excludeFolders: current.excludeFolders,
                  excludeFiles: current.excludeFiles,
                },
      },
    });
  };

  const toggleThemeItem = (slug: string, type: "folder" | "file", name: string, synced: boolean) => {
    const current = getThemeConfig(slug);
    const excludeFolders = new Set(current.excludeFolders ?? []);
    const excludeFiles = new Set(current.excludeFiles ?? []);
    if (type === "folder") {
      if (synced) excludeFolders.delete(name);
      else excludeFolders.add(name);
    } else if (synced) excludeFiles.delete(name);
    else excludeFiles.add(name);
    updateSync({
      themes: {
        ...themesMap,
        [slug]: {
          mode: "custom",
          excludeFolders: [...excludeFolders],
          excludeFiles: [...excludeFiles],
        },
      },
    });
  };

  const applyRecommendedTheme = (slug: string) => {
    const t = scan?.themes.find((x) => x.slug === slug);
    if (!t) return;
    updateSync({
      themes: {
        ...themesMap,
        [slug]: {
          mode: "custom",
          excludeFolders: t.recommendedExcludeFolders,
          excludeFiles: t.recommendedExcludeFiles,
        },
      },
    });
  };

  const applyAllRecommendations = () => {
    const plugins = { ...pluginsMap };
    for (const slug of scan?.suggestions.devPlugins ?? []) {
      plugins[slug] = "localOnly";
    }
    const themes = { ...themesMap } as Record<string, unknown>;
    for (const t of scan?.suggestions.buildThemes ?? []) {
      themes[t.slug] = {
        mode: "custom",
        excludeFolders: t.excludeFolders,
        excludeFiles: t.excludeFiles,
      };
    }
    updateSync({
      plugins,
      themes,
      recommendationsDismissed: true,
    });
  };

  const configDirty = useMemo(() => {
    if (!config) return false;
    return JSON.stringify(config) !== lastSavedJson;
  }, [config, lastSavedJson]);

  const saveConfig = async (): Promise<boolean> => {
    if (!config) return false;
    if (!authenticated) {
      requestUnlock();
      setSaveMsg("Unlock admin to save sync settings.");
      return false;
    }
    setSaveMsg("");
    const res = await saveWpDevConfig(config);
    if (!res.ok) {
      setSaveMsg(`Save failed: ${res.error}`);
      return false;
    }
    setLastSavedJson(JSON.stringify(config));
    setSaveMsg("Saved.");
    logAdmin("info", "SyncTab: saved deployment units");
    void refreshScan();
    return true;
  };

  const runPreview = async () => {
    setBusy(true);
    setPreview(null);
    setStatus("Previewing…");
    try {
      if (configDirty) {
        setStatus("Saving rules before preview…");
        const saved = await saveConfig();
        if (!saved) {
          setStatus("Save failed — fix errors before preview.");
          return;
        }
      }
      const r = await runJob("wpdev_sync_preview", { env, direction });
      if (!r.ok) {
        setStatus("Preview failed.");
        return;
      }
      const parsed = parseJsonFromOutput<SyncPreviewJson>(r.output);
      if (!parsed) {
        setStatus("Could not parse preview.");
        return;
      }
      setPreview(parsed);
      setStatus(`Preview: ${parsed.changes.totalCount} path(s) would change.`);
    } finally {
      setBusy(false);
    }
  };

  const runSync = async (dryRun: boolean) => {
    if (!dryRun && direction === "push" && env === "production") {
      if (!window.confirm("Push to PRODUCTION replaces remote files and database. Continue?")) return;
    }
    setBusy(true);
    try {
      if (configDirty) {
        setStatus("Saving rules before sync…");
        const saved = await saveConfig();
        if (!saved) {
          setStatus("Save failed.");
          return;
        }
      }
      setStatus(dryRun ? "Running dry-run…" : "Running sync…");
      const action: TerminalAction =
        direction === "push"
          ? dryRun
            ? "wpdev_push_dry"
            : "wpdev_push"
          : dryRun
            ? "wpdev_pull_dry"
            : "wpdev_pull";
      const r = await runJob(action, { env });
      setStatus(r.ok ? (dryRun ? "Dry-run done." : "Sync done.") : "Command failed.");
    } finally {
      setBusy(false);
    }
  };

  const filteredPlugins = useMemo(() => {
    const list = scan?.plugins ?? [];
    const q = pluginFilter.trim().toLowerCase();
    if (!q) return list;
    return list.filter((p) => p.slug.includes(q) || p.label.toLowerCase().includes(q));
  }, [scan, pluginFilter]);

  const hasSuggestions =
    !recommendationsDismissed &&
    ((scan?.suggestions.devPlugins.length ?? 0) > 0 ||
      (scan?.suggestions.buildThemes.length ?? 0) > 0);

  const activeThemeSlug = scan?.activeTheme ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Sync & deployment</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Control what is included in <strong>full site</strong> push/pull (files + database). Preview
          before syncing. Theme-only deploys use a separate terminal command — see help below.
        </p>
      </div>

      <SyncHelpPanel />

      <div
        className={`rounded border px-3 py-2 text-xs ${
          runnerReady
            ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40"
            : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40"
        }`}
      >
        {runnerMessage ||
          (runnerReady ? "Ready — configure deployment units, preview, then push or pull." : "Loading runner…")}
      </div>

      {hasSuggestions ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/60">
          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            We found development-only items
          </p>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
            These stay on localhost during full push — they are not removed from production.
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-slate-700 dark:text-slate-300">
            {(scan?.suggestions.devPlugins ?? []).map((s) => (
              <li key={s}>
                Plugin <strong>{s}</strong> → Local only (dev tool)
              </li>
            ))}
            {(scan?.suggestions.buildThemes ?? []).map((t) => (
              <li key={t.slug}>
                Theme <strong>{t.slug}</strong> → Partial deploy (exclude{" "}
                {t.excludeFolders.join(", ") || "dev folders"})
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => applyAllRecommendations()}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white"
            >
              Apply all
            </button>
            <button
              type="button"
              onClick={() => updateSync({ recommendationsDismissed: true })}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-700 dark:border-slate-600 dark:text-slate-300"
            >
              Not now
            </button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-5">
        <div className="space-y-4 xl:col-span-3">
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Plugins</h3>
            <p className="mt-1 text-xs text-slate-500">
              <strong>Deploy</strong> = included in full push/pull.{" "}
              <strong>Local only</strong> = stays on your laptop (production unchanged).
            </p>
            <div className="mt-3 flex justify-end">
              <input
                type="search"
                placeholder="Search…"
                value={pluginFilter}
                onChange={(e) => setPluginFilter(e.target.value)}
                className="rounded border border-slate-300 px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-950"
              />
            </div>
            <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
              {scanError ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
                  <p>{scanError}</p>
                  <button
                    type="button"
                    onClick={() => void refreshScan()}
                    className="mt-2 rounded border border-amber-300 px-2 py-1 font-semibold dark:border-amber-800"
                  >
                    Retry scan
                  </button>
                </div>
              ) : null}
              {!scanError && filteredPlugins.length === 0 ? (
                <p className="text-xs text-slate-500">No plugins detected — run pull or install WordPress.</p>
              ) : null}
              {filteredPlugins.length > 0
                ? filteredPlugins.map((p) => {
                  const mode = pluginsMap[p.slug] ?? p.mode;
                  return (
                    <div
                      key={p.slug}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2 dark:border-slate-800"
                    >
                      <div>
                        <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
                          {p.label}
                        </span>
                        {p.isDev ? (
                          <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">
                            Dev
                          </span>
                        ) : null}
                        <p className="font-mono text-[10px] text-slate-500">plugins/{p.slug}/</p>
                      </div>
                      <SegmentedToggle
                        value={mode}
                        options={[
                          { value: "sync", label: "Deploy" },
                          { value: "localOnly", label: "Local only" },
                        ]}
                        onChange={(v) => setPluginMode(p.slug, v)}
                      />
                    </div>
                  );
                })
                : null}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Themes</h3>
            <p className="mt-1 text-xs text-slate-500">
              Rules for <strong>full site</strong> push/pull only. Active theme:{" "}
              {activeThemeSlug ?? "unknown"}.
            </p>
            {scan?.themes.some((t) => t.active && t.buildTheme) ? (
              <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
                <strong>{activeThemeSlug}</strong> is a build theme. For production CSS/JS updates
                without touching the database, run:{" "}
                <code className="rounded bg-slate-200 px-1 dark:bg-slate-800">
                  npm run wp-dev -- push theme production --build
                </code>
              </p>
            ) : null}
            <div className="mt-3 space-y-2">
              {(scan?.themes ?? []).map((t) => {
                const cfg = getThemeConfig(t.slug);
                const expanded = expandedThemes.has(t.slug);
                const rows = [
                  ...t.folders.map((name) => ({
                    name,
                    type: "folder" as const,
                    synced:
                      cfg.mode === "all" ||
                      (cfg.mode === "custom" && !(cfg.excludeFolders ?? []).includes(name)),
                  })),
                  ...t.files.map((name) => ({
                    name,
                    type: "file" as const,
                    synced:
                      cfg.mode === "all" ||
                      (cfg.mode === "custom" && !(cfg.excludeFiles ?? []).includes(name)),
                  })),
                ];
                return (
                  <div
                    key={t.slug}
                    className="rounded-lg border border-slate-100 dark:border-slate-800"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                      <button
                        type="button"
                        onClick={() => {
                          setExpandedThemes((prev) => {
                            const next = new Set(prev);
                            if (next.has(t.slug)) next.delete(t.slug);
                            else next.add(t.slug);
                            return next;
                          });
                        }}
                        className="text-left text-sm font-medium text-slate-800 dark:text-slate-200"
                      >
                        {expanded ? "▼" : "▸"} {t.slug}
                        {t.active ? (
                          <span className="ml-2 text-[10px] text-brand-600 dark:text-brand-400">
                            active
                          </span>
                        ) : null}
                        {t.buildTheme ? (
                          <span className="ml-1 text-[10px] text-slate-500">build</span>
                        ) : null}
                      </button>
                      <SegmentedToggle
                        value={cfg.mode === "localOnly" ? "localOnly" : cfg.mode === "custom" ? "custom" : "all"}
                        options={[
                          { value: "all", label: "All files" },
                          { value: "custom", label: "Partial" },
                          { value: "localOnly", label: "Never deploy" },
                        ]}
                        onChange={(v) => setThemeMode(t.slug, v)}
                      />
                    </div>
                    {expanded && cfg.mode === "custom" ? (
                      <div className="border-t border-slate-100 px-3 py-2 dark:border-slate-800">
                        <p className="mb-2 text-[10px] text-slate-500">
                          Checked items are included in full push/pull. Unchecked stay on localhost.
                        </p>
                        {t.recommendedExcludeFolders.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => applyRecommendedTheme(t.slug)}
                            className="mb-2 rounded border border-slate-300 px-2 py-1 text-[10px] dark:border-slate-600"
                          >
                            Apply recommended deployment
                          </button>
                        ) : null}
                        <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                          {rows.map((row) => (
                            <label
                              key={`${row.type}-${row.name}`}
                              className="flex cursor-pointer items-center gap-1 text-[11px]"
                            >
                              <input
                                type="checkbox"
                                checked={row.synced}
                                onChange={() =>
                                  toggleThemeItem(t.slug, row.type, row.name, row.synced)
                                }
                              />
                              <span className="truncate font-mono">{row.name}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Global (push)</h3>
            <div className="mt-3 space-y-2">
              {RECOMMENDED_TOGGLES.map((item) => (
                <label key={item.key} className="flex cursor-pointer items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!disabledRecommended.includes(item.key)}
                    onChange={() => {
                      const set = new Set(disabledRecommended);
                      if (set.has(item.key)) set.delete(item.key);
                      else set.add(item.key);
                      updateSync({ disabledRecommended: [...set] });
                    }}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium">{item.label}</span>
                    <span className="block text-xs text-slate-500">{item.hint}</span>
                  </span>
                </label>
              ))}
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={skipUploads}
                  onChange={() => updateSync({ skipUploadsOnPush: !skipUploads })}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium">Skip uploads on push</span>
                  <span className="block text-xs text-slate-500">Optional — media stays on remote</span>
                </span>
              </label>
            </div>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                disabled={!config}
                onClick={() => void saveConfig()}
                className="rounded-lg bg-brand-600 px-4 py-2 text-xs font-semibold text-white"
              >
                Save deployment rules{configDirty ? " *" : ""}
              </button>
              {saveMsg ? <span className="self-center text-xs text-slate-500">{saveMsg}</span> : null}
            </div>
          </section>
        </div>

        <div className="space-y-4 xl:col-span-2">
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Preview & sync</h3>
            <p className="mt-1 text-xs text-slate-500">
              Full site sync (files + database). Theme-only deploys are not run from here.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {(["push", "pull"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => {
                    setDirection(d);
                    setPreview(null);
                  }}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize ${
                    direction === d ? "bg-brand-600 text-white" : "border border-slate-300"
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {(["staging", "production"] as const).map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => {
                    setEnv(e);
                    setPreview(null);
                  }}
                  className={`rounded-lg px-3 py-1.5 text-xs capitalize ${
                    env === e ? "bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900" : "border"
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                disabled={busy || !canRun}
                onClick={() => void runPreview()}
                className="rounded-lg bg-brand-600 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Preview changes
              </button>
              <button
                type="button"
                disabled={busy || !canRun}
                onClick={() => void runSync(false)}
                className="rounded-lg border border-amber-400 bg-amber-50 py-2 text-xs font-semibold text-amber-900 dark:bg-amber-950/40"
              >
                {direction === "push" ? `Push localhost → ${env}` : `Pull ${env} → localhost`}
              </button>
            </div>
            {status ? <p className="mt-2 text-xs font-medium">{status}</p> : null}

            {preview ? (
              <div className="mt-4 space-y-3 text-xs">
                <div className="grid grid-cols-3 gap-1 text-center">
                  <div className="rounded bg-emerald-100 p-2 dark:bg-emerald-950/50">
                    <div className="text-lg font-bold">{preview.changes.added.length}</div>
                    <div>New</div>
                  </div>
                  <div className="rounded bg-blue-100 p-2 dark:bg-blue-950/50">
                    <div className="text-lg font-bold">{preview.changes.updated.length}</div>
                    <div>Updated</div>
                  </div>
                  <div className="rounded bg-rose-100 p-2 dark:bg-rose-950/50">
                    <div className="text-lg font-bold">{preview.changes.deleted.length}</div>
                    <div>Deleted</div>
                  </div>
                </div>

                {preview.willPush.length > 0 ? (
                  <div>
                    <p className="mb-1 font-semibold text-emerald-800 dark:text-emerald-300">Will push</p>
                    <ul className="max-h-24 overflow-auto font-mono text-[10px] text-slate-600 dark:text-slate-400">
                      {preview.willPush.slice(0, 15).map((w) => (
                        <li key={w.path}>{w.path}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {preview.staysLocal.length > 0 ? (
                  <div>
                    <p className="mb-1 font-semibold text-slate-700 dark:text-slate-300">Stays local</p>
                    <ul className="max-h-24 overflow-auto text-slate-600 dark:text-slate-400">
                      {preview.staysLocal.slice(0, 12).map((s) => (
                        <li key={s.path}>{s.path}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {[...preview.safetyWarnings, ...preview.warnings].map((w) => (
                  <p
                    key={w}
                    className="rounded border border-amber-200 bg-amber-50 p-2 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40"
                  >
                    {w}
                  </p>
                ))}
              </div>
            ) : null}
          </section>
        </div>
      </div>

      <details className="text-xs text-slate-500">
        <summary className="cursor-pointer">Command output</summary>
        <pre className="mt-2 max-h-40 overflow-auto rounded border border-slate-200 bg-slate-50 p-2 font-mono text-[10px] dark:border-slate-700 dark:bg-slate-950">
          {rawOutput || "—"}
        </pre>
      </details>
    </div>
  );
}

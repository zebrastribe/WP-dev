import { useEffect, useMemo, useState } from "react";
import {
  JobProgressPanel,
  createLocalAdapter,
  loadLocalStatus,
  loadWpDevConfig,
  logAdmin,
  syncActionsForRoute,
  themeActionsForRoute,
  useRunnerJob,
  useRunnerSecrets,
} from "@wpdev/web-host";
import {
  ENV_LABEL,
  LOCAL_SYNC_ROUTES,
  type SyncRouteId,
  type SyncScopePreset,
} from "../adapter/types";
import { LockedGate } from "../LockedGate";
import { outlineButtonClass, secondaryAccentButtonClass } from "../uiClasses";

type Scope = Extract<SyncScopePreset, "theme_only" | "full">;

const FULL_HINT: Partial<Record<SyncRouteId, string>> = {
  dev_to_staging: "Files and database → Staging",
  staging_to_dev: "Files and database → Local",
  production_to_dev: "Files and database → Local",
};

const SITE_ROUTE_IDS: SyncRouteId[] = ["staging_to_dev", "production_to_dev", "dev_to_staging"];

function hostNotReady(host: string): boolean {
  const value = host.trim().toLowerCase();
  return value === "" || value.endsWith(".invalid");
}

/**
 * Primary Sync: scope first (theme-only default), then route → preview → start.
 * Theme-only maps to `push/pull theme` — never the database.
 */
export function SyncPage({ mode = "site" }: { mode?: "site" | "theme" } = {}) {
  const { canRun } = useRunnerSecrets("Unlock admin to sync between environments.");
  const { job, run, cancel, outputRef, reset, isRunning } = useRunnerJob("sync", canRun);
  const adapter = useMemo(() => createLocalAdapter(run), [run]);

  const [scope, setScope] = useState<Scope>(mode === "theme" ? "theme_only" : "full");
  const [routeId, setRouteId] = useState<SyncRouteId>("dev_to_staging");
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [buildTheme, setBuildTheme] = useState(true);
  const [themeSlug, setThemeSlug] = useState<string | null>(null);
  const [themeName, setThemeName] = useState<string | null>(null);
  const [remoteMeta, setRemoteMeta] = useState<{
    staging: { host: string; url: string };
    production: { host: string; url: string };
  }>({
    staging: { host: "", url: "" },
    production: { host: "", url: "" },
  });

  const primaryRoutes = LOCAL_SYNC_ROUTES.filter((r) => r.primary && !r.hostedOnly);

  /** Theme-only also allows Dev → Production (safe files-only path). */
  const themePushTargets = [
    { id: "dev_to_staging" as const, label: "Local → Staging", dest: "staging" as const },
    { id: "dev_to_production" as const, label: "Local → Production", dest: "production" as const },
  ];
  const themePullTargets = [
    { id: "staging_to_dev" as const, label: "Staging → Local", env: "staging" as const },
    { id: "production_to_dev" as const, label: "Production → Local", env: "production" as const },
  ];

  const [themeTarget, setThemeTarget] = useState<"dev_to_staging" | "dev_to_production">(
    "dev_to_staging",
  );
  const [themePullId, setThemePullId] = useState<"staging_to_dev" | "production_to_dev" | null>(
    null,
  );

  const route = LOCAL_SYNC_ROUTES.find((r) => r.id === routeId) ?? primaryRoutes[0]!;
  const themePush = themePushTargets.find((t) => t.id === themeTarget)!;
  const themePull = themePullTargets.find((t) => t.id === themePullId);
  const themeDirection: "push" | "pull" = themePull ? "pull" : "push";
  const themeEnv = themePull ? themePull.env : themePush.dest;
  const themeLabel = themePull ? themePull.label : themePush.label;

  /** Route identity for preview gating (exclude build flag — preview is dry-run without build). */
  const selectionKey =
    scope === "theme_only" ? `theme:${themeDirection}:${themeEnv}` : `full:${routeId}`;

  useEffect(() => {
    setPreviewKey(null);
  }, [selectionKey]);

  // Reload when admin unlocks — a mount-time load can 403 before the session cookie exists
  // and leave staging.host empty until a full page reload.
  useEffect(() => {
    if (!canRun) return;
    let cancelled = false;
    void (async () => {
      const [cfg, status] = await Promise.all([loadWpDevConfig(), loadLocalStatus()]);
      if (cancelled) return;
      if (status.ok && status.theme?.slug) {
        setThemeSlug(status.theme.slug);
        setThemeName(status.theme.name || status.theme.slug);
      } else if (cfg) {
        const local = cfg.local as { themeSlug?: string; themePath?: string } | undefined;
        const slug =
          local?.themeSlug?.trim() ||
          local?.themePath?.trim().replace(/\/$/, "").split("/").pop() ||
          "agency-starter";
        setThemeSlug(slug);
        setThemeName(slug);
      }
      if (!cfg) return;
      const staging = cfg.staging as { host?: string; url?: string } | undefined;
      const production = cfg.production as { host?: string; url?: string } | undefined;
      setRemoteMeta({
        staging: { host: String(staging?.host ?? "").trim(), url: String(staging?.url ?? "").trim() },
        production: {
          host: String(production?.host ?? "").trim(),
          url: String(production?.url ?? "").trim(),
        },
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [canRun]);

  const selectFullRoute = (id: SyncRouteId) => {
    const next = LOCAL_SYNC_ROUTES.find((r) => r.id === id);
    if (next?.hostedOnly) return;
    setRouteId(id);
  };

  const runSync = async (dryRun: boolean) => {
    const keyAtStart = selectionKey;

    if (scope === "theme_only") {
      const action = themeActionsForRoute(themeDirection, dryRun);
      const slugNote = themeSlug ? ` (${themeSlug})` : "";
      const label = `${dryRun ? "Preview: " : ""}Theme ${themeLabel}${slugNote}`;
      if (!dryRun && themeEnv === "production" && themeDirection === "push") {
        if (
          !window.confirm(
            `Push theme files${slugNote} to Production?\n\n` +
              "This uses local.themePath / themeSlug from config (not necessarily the WP active theme).\n" +
              "Database and uploads will NOT change.",
          )
        ) {
          return;
        }
      }
      if (!dryRun && themeDirection === "pull") {
        if (
          !window.confirm(
            `Pull theme${slugNote} from ${ENV_LABEL[themeEnv === "staging" ? "staging" : "production"]} into Local?\n\nLocal theme files will be overwritten.`,
          )
        ) {
          return;
        }
      }
      logAdmin("info", "SyncPage: theme", label);
      const themeArgs: Record<string, string> = {
        env: themeEnv,
        // Build on preview too so Start ships the same tree.
        ...(themeDirection === "push" && buildTheme ? { build: "1" } : {}),
      };
      if (!dryRun && themeDirection === "push" && themeEnv === "production") {
        themeArgs.confirm = "SYNC_PRODUCTION";
      }
      if (!dryRun && themeDirection === "push" && themeEnv === "staging") {
        themeArgs.confirm = remoteMeta.staging.host || "staging";
      }
      const result = await adapter.runJob(action, themeArgs, label, "sync");
      if (dryRun) setPreviewKey(result.ok ? keyAtStart : null);
      return;
    }

    if (route.hostedOnly) return;
    const runnerEnv = route.runnerEnv;
    const meta =
      runnerEnv === "production"
        ? remoteMeta.production
        : runnerEnv === "staging"
          ? remoteMeta.staging
          : { host: "", url: "" };
    if (hostNotReady(meta.host)) {
      const label = runnerEnv === "production" ? "Production" : "Staging";
      window.alert(`${label} is not set up yet. Save the server on Setup, then try again.`);
      return;
    }
    if (!dryRun) {
      if (route.destination === "production") {
        window.alert("Full-site Local → Production is not offered. Use Theme only for live CSS/JS.");
        return;
      }
      const hostLine = meta.host ? `SSH host: ${meta.host}` : "SSH host: (not set in config)";
      const urlLine = meta.url ? `URL: ${meta.url}` : "";
      if (
        !window.confirm(
          `FULL SITE sync ${route.label}.\n\n${hostLine}${urlLine ? `\n${urlLine}` : ""}\n\nThis replaces ${ENV_LABEL[route.destination]} files AND database. Continue?`,
        )
      ) {
        return;
      }
      if (runnerEnv === "staging" && !meta.host) {
        window.alert("Set staging.host in config (Setup) before full-site sync.");
        return;
      }
    }

    const action = syncActionsForRoute(route.direction, dryRun);
    const label = `${dryRun ? "Preview: " : ""}Full site ${route.label}`;
    logAdmin("info", "SyncPage: full", label);
    const args: Record<string, string> = { env: route.runnerEnv };
    if (!dryRun && route.runnerEnv === "production") {
      args.confirm = "SYNC_PRODUCTION";
    }
    if (!dryRun && route.runnerEnv === "staging") {
      args.confirm = remoteMeta.staging.host;
    }
    const result = await adapter.runJob(action, args, label, "sync");
    if (dryRun) setPreviewKey(result.ok ? keyAtStart : null);
  };

  // Theme-only is the safe lane — Start does not require Preview. Full-site still does.
  const previewDone = previewKey === selectionKey;
  const selectedHost =
    route.runnerEnv === "production" ? remoteMeta.production.host : remoteMeta.staging.host;
  const selectedNotReady = mode === "site" && hostNotReady(selectedHost);
  const canStart =
    canRun &&
    !isRunning &&
    (scope === "theme_only" || !route.hostedOnly) &&
    (scope === "theme_only" || previewDone) &&
    !selectedNotReady;

  const siteRoutes = SITE_ROUTE_IDS.map(
    (id) => LOCAL_SYNC_ROUTES.find((route) => route.id === id)!,
  );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          {mode === "theme" ? "Theme files" : "Sync"}
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          {mode === "theme"
            ? "Copies the theme folder from this project. The database and uploads stay as they are."
            : "Pull a server onto this computer, or push this computer to Staging. A whole-site push to Production is not available."}
        </p>
      </div>

      {mode === "theme" ? (
            <div className="space-y-3">
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
                Theme:{" "}
                <strong className="text-slate-900 dark:text-white">
                  {themeName && themeSlug && themeName !== themeSlug
                    ? `${themeName} (${themeSlug})`
                    : themeSlug ?? themeName ?? "…"}
                </strong>
              </p>
              <div className="flex flex-wrap gap-2">
                {themePushTargets.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setScope("theme_only");
                      setThemeTarget(t.id);
                      setThemePullId(null);
                    }}
                    className={`rounded-lg px-4 py-2.5 text-left text-sm ${
                      !themePull && themeTarget === t.id
                        ? "bg-brand-600 text-white shadow-sm"
                        : "border border-slate-300 dark:border-slate-600"
                    }`}
                  >
                    <span className="block font-semibold">{t.label}</span>
                    <span
                      className={`mt-0.5 block text-xs ${
                        !themePull && themeTarget === t.id ? "text-brand-100" : "text-slate-500"
                      }`}
                    >
                      Theme files only
                    </span>
                  </button>
                ))}
                {themePullTargets.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        setScope("theme_only");
                        setThemePullId(t.id);
                      }}
                      className={`rounded-lg px-3 py-2 text-left text-xs ${
                        themePullId === t.id
                          ? "bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900"
                          : outlineButtonClass
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={buildTheme}
                  onChange={(e) => setBuildTheme(e.target.checked)}
                  disabled={Boolean(themePull)}
                />
                Build theme before push (<code className="text-xs">npm run production</code>)
              </label>
            </div>
      ) : (
            <div className="flex flex-wrap gap-2">
              {siteRoutes.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setScope("full");
                    selectFullRoute(item.id);
                  }}
                  className={`rounded-lg px-4 py-2.5 text-left text-sm ${
                    routeId === item.id
                      ? "bg-brand-600 text-white shadow-sm"
                      : "border border-slate-300 dark:border-slate-600"
                  }`}
                >
                  <span className="block font-semibold">{item.label}</span>
                  <span
                    className={`mt-0.5 block text-xs ${
                      routeId === item.id ? "text-brand-100" : "text-slate-500"
                    }`}
                  >
                    {FULL_HINT[item.id]}
                  </span>
                </button>
              ))}
            </div>
      )}

      <LockedGate message="Unlock admin to run preview and sync.">
        <div className="space-y-4">
          <div className="space-y-3">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {scope === "theme_only" ? `Theme ${themeLabel}` : route.label}
            </p>
            {selectedNotReady ? (
              <p className="text-sm text-amber-800">
                {route.runnerEnv === "production" ? "Production" : "Staging"} is not set up yet.
                Save the server on Setup, then try again.
              </p>
            ) : null}
            <button
              type="button"
              disabled={!canRun || isRunning || selectedNotReady}
              className={`${secondaryAccentButtonClass} rounded-lg px-5 py-2.5 text-sm disabled:opacity-50`}
              onClick={() => void runSync(true)}
            >
              Preview changes
            </button>
            {previewDone ? (
              <p className="text-xs text-emerald-700 dark:text-emerald-300">
                Preview complete for this route.
                {scope === "full"
                  ? " (Preview is files only; Start still replaces the database.)"
                  : ""}
              </p>
            ) : scope === "full" ? (
              <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
                Required for full-site: run Preview once, then Start unlocks.
              </p>
            ) : (
              <p className="text-xs text-slate-500">Optional for theme sync — Start works without it.</p>
            )}
          </div>

          <div className="space-y-3">
            {scope === "theme_only" ? (
              <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-100">
                Safe lane: updates <strong>theme files</strong> on{" "}
                <strong>
                  {themeDirection === "push"
                    ? ENV_LABEL[themeEnv === "staging" ? "staging" : "production"]
                    : "Local"}
                </strong>
                . Database and uploads stay untouched.
              </p>
            ) : (
              <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
                This replaces the files and the database on <strong>{ENV_LABEL[route.destination]}</strong>.
              </p>
            )}
            <button
              type="button"
              disabled={!canStart}
              className={`rounded-lg px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50 ${
                scope === "theme_only" ? "bg-brand-600" : "bg-amber-600"
              }`}
              onClick={() => void runSync(false)}
              title={
                !canStart
                  ? scope === "full" && !previewDone
                    ? "Run Preview first"
                    : "Unlock admin or wait for the current job"
                  : undefined
              }
            >
              {scope === "theme_only" ? "Start theme sync" : "Start full-site sync"}
            </button>
            {!canStart && scope === "full" && !previewDone ? (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Start is locked until Preview finishes successfully.
              </p>
            ) : null}
          </div>
        </div>

        <JobProgressPanel
          job={job}
          outputRef={outputRef}
          onStop={isRunning ? () => void cancel() : undefined}
        />
        {job.phase !== "idle" && job.phase !== "running" ? (
          <button type="button" className="mt-2 text-xs text-slate-500 underline" onClick={reset}>
            Clear log
          </button>
        ) : null}

      </LockedGate>
    </div>
  );
}

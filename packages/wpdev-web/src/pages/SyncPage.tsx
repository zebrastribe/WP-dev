import { useEffect, useMemo, useState } from "react";
import {
  JobProgressPanel,
  SyncTab,
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
  dev_to_staging: "Overwrites Staging files + database",
  staging_to_dev: "Overwrites Local files + database",
  production_to_dev: "Overwrites Local files + database",
};

/**
 * Primary Sync: scope first (theme-only default), then route → preview → start.
 * Theme-only maps to `push/pull theme` — never the database.
 */
export function SyncPage() {
  const { canRun } = useRunnerSecrets("Unlock admin to sync between environments.");
  const { job, run, cancel, outputRef, reset, isRunning } = useRunnerJob("sync", canRun);
  const adapter = useMemo(() => createLocalAdapter(run), [run]);

  const [scope, setScope] = useState<Scope>("theme_only");
  const [routeId, setRouteId] = useState<SyncRouteId>("dev_to_staging");
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [showMoreRoutes, setShowMoreRoutes] = useState(false);
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
  const advancedLocal = LOCAL_SYNC_ROUTES.filter((r) => !r.primary && !r.hostedOnly);

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
    if (!next?.primary) setShowMoreRoutes(true);
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
    if (!dryRun) {
      if (route.destination === "production") {
        window.alert("Full-site Local → Production is not offered. Use Theme only for live CSS/JS.");
        return;
      }
      const runnerEnv = route.runnerEnv;
      const meta =
        runnerEnv === "production"
          ? remoteMeta.production
          : runnerEnv === "staging"
            ? remoteMeta.staging
            : { host: "", url: "" };
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
  const canStart =
    canRun &&
    !isRunning &&
    (scope === "theme_only" || !route.hostedOnly) &&
    (scope === "theme_only" || previewDone);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Sync</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Pick what to sync first — theme-only is the safe day-to-day path. Full-site sync refuses a
          mistyped remote path (parent of other sites or WP-dev in the docroot) — verify path in Setup
          staging first.
        </p>
      </div>

      <ol className="list-none space-y-8 p-0">
        <li className="space-y-3">
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-bold uppercase tracking-wide text-brand-600 dark:text-brand-400">
              1 · What to sync
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => {
                setScope("theme_only");
                setThemePullId(null);
              }}
              className={`rounded-xl border px-4 py-3 text-left ${
                scope === "theme_only"
                  ? "border-emerald-500 bg-emerald-50 dark:border-emerald-600 dark:bg-emerald-950/40"
                  : "border-slate-300 dark:border-slate-600"
              }`}
            >
              <span className="block text-sm font-bold text-slate-900 dark:text-white">
                Theme only
                <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                  Recommended
                </span>
              </span>
              <span className="mt-1 block text-xs text-slate-600 dark:text-slate-400">
                Configured theme folder only (from local.themePath / themeSlug). Does{" "}
                <strong>not</strong> touch the database or uploads.
                Use this while developing on a live site.
              </span>
            </button>
            <button
              type="button"
              onClick={() => setScope("full")}
              className={`rounded-xl border px-4 py-3 text-left ${
                scope === "full"
                  ? "border-amber-500 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40"
                  : "border-slate-300 dark:border-slate-600"
              }`}
            >
              <span className="block text-sm font-bold text-slate-900 dark:text-white">
                Full site
                <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                  Destructive
                </span>
              </span>
              <span className="mt-1 block text-xs text-slate-600 dark:text-slate-400">
                Entire environment — plugins, themes, uploads, <strong>and database</strong>.
                Only for cloning or resetting an environment.
              </span>
            </button>
          </div>
        </li>

        <li className="space-y-3">
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-bold uppercase tracking-wide text-brand-600 dark:text-brand-400">
              2 · Route
            </span>
            <span className="text-sm text-slate-500">Source → destination</span>
          </div>

            {scope === "theme_only" ? (
            <div className="space-y-3">
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
                Syncing theme:{" "}
                <strong className="text-slate-900 dark:text-white">
                  {themeName && themeSlug && themeName !== themeSlug
                    ? `${themeName} (${themeSlug})`
                    : themeSlug ?? themeName ?? "…"}
                </strong>
                <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                  From your WP-dev config / default theme folder — not WordPress “active theme”.
                </span>
              </p>
              <p className="text-xs font-medium text-slate-500">Push theme from Local</p>
              <div className="flex flex-wrap gap-2">
                {themePushTargets.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
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
                      Theme files only → {ENV_LABEL[t.dest === "staging" ? "staging" : "production"]}
                    </span>
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
              <details className="text-sm">
                <summary className="cursor-pointer font-medium text-slate-600 dark:text-slate-300">
                  Pull theme into Local
                </summary>
                <div className="mt-2 flex flex-wrap gap-2">
                  {themePullTargets.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setThemePullId(t.id)}
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
              </details>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {primaryRoutes.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => selectFullRoute(r.id)}
                    className={`rounded-lg px-4 py-2.5 text-left text-sm ${
                      routeId === r.id
                        ? "bg-amber-600 text-white shadow-sm"
                        : "border border-slate-300 dark:border-slate-600"
                    }`}
                  >
                    <span className="block font-semibold">{r.label}</span>
                    <span
                      className={`mt-0.5 block text-xs ${
                        routeId === r.id ? "text-amber-100" : "text-slate-500"
                      }`}
                    >
                      {FULL_HINT[r.id]}
                    </span>
                  </button>
                ))}
              </div>
              <details
                className="text-sm"
                open={showMoreRoutes}
                onToggle={(e) => setShowMoreRoutes((e.target as HTMLDetailsElement).open)}
              >
                <summary className="cursor-pointer font-medium text-slate-600 dark:text-slate-300">
                  More full-site routes
                </summary>
                <div className="mt-2 flex flex-wrap gap-2">
                  {advancedLocal.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => selectFullRoute(r.id)}
                      className={`rounded-lg px-3 py-2 text-left text-xs ${
                        routeId === r.id
                          ? "bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900"
                          : outlineButtonClass
                      }`}
                    >
                      <span className="block font-semibold">{r.label}</span>
                      <span className="opacity-70">{FULL_HINT[r.id]}</span>
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  Staging ↔ Production full sync runs in the hosted app (coming later).
                </p>
              </details>
            </div>
          )}
        </li>
      </ol>

      <LockedGate message="Unlock admin to run preview and sync.">
        <ol className="mt-8 list-none space-y-8 p-0" start={3}>
          <li className="space-y-3">
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-bold uppercase tracking-wide text-brand-600 dark:text-brand-400">
                3 · Preview
              </span>
              <span className="text-sm text-slate-500">
                {scope === "theme_only" ? `Theme ${themeLabel}` : `Full site ${route.label}`}
              </span>
            </div>
            <button
              type="button"
              disabled={!canRun || isRunning}
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
          </li>

          <li className="space-y-3">
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-bold uppercase tracking-wide text-brand-600 dark:text-brand-400">
                4 · Start
              </span>
            </div>
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
                Destructive: replaces <strong>{ENV_LABEL[route.destination]}</strong>{" "}
                <strong>files and database</strong>. Prefer Theme only for day-to-day work.
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
          </li>
        </ol>

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

        <details className="mt-8 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <summary className="cursor-pointer text-sm font-semibold text-slate-800 dark:text-slate-100">
            Full-site excludes (not used by Theme only)
          </summary>
          <div className="mt-3">
            <SyncTab rulesOnly />
          </div>
        </details>
      </LockedGate>
    </div>
  );
}

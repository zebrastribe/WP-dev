import { useCallback, useEffect, useState } from "react";
import { useAdminAuth } from "./AdminAuthProvider";
import { JobProgressPanel } from "./JobProgressPanel";
import { useRunnerJob } from "./useRunnerJob";
import { useRunnerSecrets } from "./useRunnerSecrets";
import { secondaryAccentButtonClass, outlineButtonClass } from "./uiClasses";

/** Keep in sync with src/services/php-version.ts SUPPORTED_PHP_VERSIONS (php show --json.allowed is source of truth after Detect). */
const PHP_OPTIONS = ["7.4", "8.0", "8.1", "8.2", "8.3", "8.4", "8.5"] as const;
type PhpOpt = (typeof PHP_OPTIONS)[number];
type PhpEnv = "local" | "staging" | "production";

type PhpShowJson = {
  env: PhpEnv;
  currentVersion: string | null;
  strategy: string;
  supported: boolean;
  detail: string;
  allowed: string[];
  rollback: { previousVersion: string | null; at: string; strategy: string } | null;
};

type EnvUiState = {
  selected: PhpOpt;
  status: PhpShowJson | null;
  error: string | null;
  loading: boolean;
};

const ENV_LABEL: Record<PhpEnv, string> = {
  local: "Local — localhost",
  staging: "Staging — web",
  production: "Production — web",
};

function parsePhpShowJson(output: string): PhpShowJson | null {
  const start = output.indexOf("{");
  if (start < 0) return null;
  try {
    return JSON.parse(output.slice(start)) as PhpShowJson;
  } catch {
    return null;
  }
}

function defaultEnvState(): EnvUiState {
  return { selected: "8.2", status: null, error: null, loading: false };
}

/** Local is always changeable via Docker; remotes only when detect.supported. */
function canChangePhp(env: PhpEnv, status: PhpShowJson | null): boolean {
  if (!status) return false;
  if (env === "local") return true;
  return status.supported;
}

export function PhpVersionsPanel() {
  const { authenticated, requestUnlock } = useAdminAuth();
  const { canRun } = useRunnerSecrets("Host runner not ready");
  const { job, outputRef, run, cancel, reset } = useRunnerJob("sync", canRun && authenticated);

  const [envs, setEnvs] = useState<Record<PhpEnv, EnvUiState>>({
    local: defaultEnvState(),
    staging: defaultEnvState(),
    production: defaultEnvState(),
  });
  const [restartLocal, setRestartLocal] = useState(true);
  const [busyEnv, setBusyEnv] = useState<PhpEnv | null>(null);

  const patchEnv = useCallback((env: PhpEnv, patch: Partial<EnvUiState>) => {
    setEnvs((prev) => ({ ...prev, [env]: { ...prev[env]!, ...patch } }));
  }, []);

  const refreshEnv = useCallback(
    async (env: PhpEnv) => {
      if (!authenticated) {
        requestUnlock();
        return;
      }
      patchEnv(env, { loading: true, error: null });
      setBusyEnv(env);
      const res = await run("wpdev_php_show", { env }, `PHP status (${env})`);
      const parsed = parsePhpShowJson(res.output);
      if (!res.ok || !parsed) {
        patchEnv(env, {
          loading: false,
          error: res.ok ? "Could not parse PHP status JSON" : res.output || "Failed",
          status: null,
        });
        setBusyEnv(null);
        return;
      }
      const selected =
        parsed.currentVersion && PHP_OPTIONS.includes(parsed.currentVersion as PhpOpt)
          ? (parsed.currentVersion as PhpOpt)
          : "8.2";
      patchEnv(env, { loading: false, status: parsed, selected, error: null });
      setBusyEnv(null);
    },
    [authenticated, patchEnv, requestUnlock, run],
  );

  useEffect(() => {
    if (authenticated && canRun) {
      void refreshEnv("local");
    }
  }, [authenticated, canRun]); // eslint-disable-line react-hooks/exhaustive-deps -- initial local only

  const applySet = async (env: PhpEnv) => {
    if (!authenticated) {
      requestUnlock();
      return;
    }
    const st = envs[env]!;
    if (!canChangePhp(env, st.status)) {
      window.alert(
        st.status
          ? `PHP cannot be changed from WP-dev on ${ENV_LABEL[env]}.\n${st.status.detail}\n\nUse the hosting panel, then Refresh.`
          : `Detect PHP for ${ENV_LABEL[env]} first (Refresh).`,
      );
      return;
    }
    const version = st.selected;
    if (env === "staging") {
      const ok = window.confirm(
        `Change Staging PHP to ${version}? A rollback snapshot will be saved first.`,
      );
      if (!ok) return;
    }
    if (env === "production") {
      const ok = window.confirm(
        `Change PRODUCTION PHP to ${version}? A rollback snapshot will be saved first.`,
      );
      if (!ok) return;
    }
    setBusyEnv(env);
    const args: Record<string, string> = { env, version };
    if (env === "local" && restartLocal) args.restart = "1";
    const res = await run("wpdev_php_set", args, `Set PHP ${version} (${env})`);
    if (res.ok) await refreshEnv(env);
    else patchEnv(env, { error: res.output || "Set failed" });
    setBusyEnv(null);
  };

  const applyRollback = async (env: PhpEnv) => {
    if (!authenticated) {
      requestUnlock();
      return;
    }
    if (!envs[env]!.status?.rollback) {
      window.alert(`No rollback snapshot for ${env}.`);
      return;
    }
    if (env === "production") {
      const ok = window.confirm("Roll back PRODUCTION PHP selector to the previous snapshot?");
      if (!ok) return;
    }
    setBusyEnv(env);
    const args: Record<string, string> = { env };
    if (env === "local" && restartLocal) args.restart = "1";
    const res = await run("wpdev_php_rollback", args, `Rollback PHP (${env})`);
    if (res.ok) await refreshEnv(env);
    else patchEnv(env, { error: res.output || "Rollback failed" });
    setBusyEnv(null);
  };

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">PHP versions</h3>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Local uses Docker (changeable here). Staging/Production: Refresh to detect the running
            version; a version dropdown appears only when WP-dev can change PHP on that host.
            Otherwise use the hosting panel.
          </p>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
          <input
            type="checkbox"
            checked={restartLocal}
            onChange={(e) => setRestartLocal(e.target.checked)}
          />
          Restart local stack on Local set/rollback
        </label>
      </div>

      {!authenticated && (
        <p className="text-sm text-amber-800 dark:text-amber-200">
          Unlock admin (top right) to manage PHP versions.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {(["local", "staging", "production"] as const).map((env) => {
          const st = envs[env]!;
          const busy = busyEnv === env || st.loading;
          const changeable = canChangePhp(env, st.status);
          const detected = st.status !== null;
          const versionLabel = st.loading
            ? "…"
            : st.status?.currentVersion
              ? st.status.currentVersion
              : detected
                ? "unknown"
                : "not detected yet";

          return (
            <div
              key={env}
              className="flex flex-col gap-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {ENV_LABEL[env]}
                </p>
                <button
                  type="button"
                  className={`${outlineButtonClass} rounded-md px-2 py-1 text-xs`}
                  disabled={busy || !canRun}
                  onClick={() => void refreshEnv(env)}
                >
                  {detected ? "Refresh" : "Detect"}
                </button>
              </div>

              <p className="text-xs text-slate-500 dark:text-slate-400">
                Current:{" "}
                <span className="font-medium text-slate-800 dark:text-slate-200">{versionLabel}</span>
              </p>

              {!detected && !st.loading ? (
                <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                  {env === "local"
                    ? "Click Detect to read local Docker PHP."
                    : "Click Detect to read PHP over SSH. No version dropdown until we know whether this host allows changes."}
                </p>
              ) : null}

              {st.status?.detail ? (
                <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                  {st.status.detail}
                </p>
              ) : null}

              {detected && !changeable ? (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
                  Change PHP in the <strong>hosting panel</strong>, then Detect again to confirm.
                  WP-dev will not offer Apply here.
                </p>
              ) : null}

              {changeable ? (
                <>
                  <label className="block">
                    <span className="text-[11px] font-medium text-slate-600 dark:text-slate-400">
                      Set to
                    </span>
                    <select
                      className="mt-0.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                      value={st.selected}
                      disabled={busy}
                      onChange={(e) =>
                        patchEnv(env, {
                          selected: PHP_OPTIONS.includes(e.target.value as PhpOpt)
                            ? (e.target.value as PhpOpt)
                            : "8.2",
                        })
                      }
                    >
                      {(st.status?.allowed?.length
                        ? st.status.allowed.filter((v): v is PhpOpt =>
                            PHP_OPTIONS.includes(v as PhpOpt),
                          )
                        : [...PHP_OPTIONS]
                      ).map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="mt-auto flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={`${secondaryAccentButtonClass} rounded-md px-3 py-1.5 text-xs`}
                      disabled={busy || !canRun || !authenticated || st.loading}
                      onClick={() => void applySet(env)}
                    >
                      {busy ? "Working…" : "Apply"}
                    </button>
                    <button
                      type="button"
                      className={`${outlineButtonClass} rounded-md px-3 py-1.5 text-xs`}
                      disabled={busy || !canRun || !authenticated || !st.status?.rollback}
                      onClick={() => void applyRollback(env)}
                      title={
                        st.status?.rollback
                          ? `Restore ${st.status.rollback.previousVersion ?? "previous"}`
                          : "No snapshot yet"
                      }
                    >
                      Rollback
                    </button>
                  </div>
                  {st.status?.rollback ? (
                    <p className="text-[11px] text-emerald-700 dark:text-emerald-300">
                      Snapshot: {st.status.rollback.previousVersion ?? "files"} (
                      {new Date(st.status.rollback.at).toLocaleString()})
                    </p>
                  ) : (
                    <p className="text-[11px] text-slate-400">No rollback snapshot yet</p>
                  )}
                </>
              ) : null}

              {st.error ? (
                <p className="text-xs text-red-700 dark:text-red-300">{st.error}</p>
              ) : null}
            </div>
          );
        })}
      </div>

      <JobProgressPanel
        job={job}
        outputRef={outputRef}
        onStop={job.phase === "running" ? () => void cancel() : undefined}
      />
      {job.phase !== "idle" && job.phase !== "running" ? (
        <button type="button" className="text-xs text-slate-500 underline" onClick={reset}>
          Clear log
        </button>
      ) : null}
    </section>
  );
}

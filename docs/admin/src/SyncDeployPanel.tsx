import { useEffect, useState } from "react";
import { logAdmin } from "./adminLog";
import { loadWpDevConfig, type TerminalAction } from "./api";
import { JobProgressPanel } from "./JobProgressPanel";
import { useRunnerJob } from "./useRunnerJob";
import { toggleButtonClass } from "./uiClasses";

type RemoteEnv = "staging" | "production";
type SyncDirection = "push" | "pull";

type SyncDeployPanelProps = {
  canRun: boolean;
  runnerMessage: string;
  title?: string;
  /** Hide env picker and lock to one target */
  fixedEnv?: RemoteEnv;
  /** Default shown directions; both enabled unless fixedDirection is set */
  directions?: SyncDirection[];
  /** Lock direction (e.g. push-only on staging step) */
  fixedDirection?: SyncDirection;
  /** Allow Production in the env picker (default false — full push to prod is unsafe from Setup). */
  allowProduction?: boolean;
  hint?: string;
  onBeforeRun?: () => Promise<boolean>;
};

export function SyncDeployPanel({
  canRun,
  runnerMessage,
  title = "Deploy from browser",
  fixedEnv,
  directions = ["push", "pull"],
  fixedDirection,
  allowProduction = false,
  hint,
  onBeforeRun,
}: SyncDeployPanelProps) {
  const [env, setEnv] = useState<RemoteEnv>(fixedEnv ?? "staging");
  const [direction, setDirection] = useState<SyncDirection>(fixedDirection ?? "push");
  const [hosts, setHosts] = useState<{ staging: string; production: string }>({
    staging: "",
    production: "",
  });
  const { job, run, cancel, outputRef, isRunning } = useRunnerJob("sync", canRun);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const cfg = await loadWpDevConfig();
      if (cancelled || !cfg) return;
      const staging = cfg.staging as { host?: string } | undefined;
      const production = cfg.production as { host?: string } | undefined;
      setHosts({
        staging: String(staging?.host ?? "").trim(),
        production: String(production?.host ?? "").trim(),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeEnv = fixedEnv ?? env;
  const activeDirection = fixedDirection ?? direction;
  const busy = isRunning;
  const envChoices = (
    allowProduction ? (["staging", "production"] as const) : (["staging"] as const)
  ).filter((e) => !fixedEnv || e === fixedEnv);

  const runDeploy = async (dryRun: boolean) => {
    if (activeDirection === "push" && activeEnv === "production" && !allowProduction) {
      window.alert(
        "Full-site Dev → Production is not offered here. Use Sync → Theme only for live theme files.",
      );
      return;
    }
    if (!dryRun) {
      const host = hosts[activeEnv];
      const hostLine = host ? `SSH host: ${host}\n\n` : "";
      if (
        activeDirection === "push" &&
        activeEnv === "production" &&
        !window.confirm(`${hostLine}Push to PRODUCTION replaces remote files and database. Continue?`)
      ) {
        return;
      }
      if (
        activeDirection === "pull" &&
        activeEnv === "production" &&
        !window.confirm(`${hostLine}Pull PRODUCTION → localhost replaces local files and database. Continue?`)
      ) {
        return;
      }
      if (
        activeDirection === "push" &&
        activeEnv === "staging" &&
        !window.confirm(`${hostLine}Push localhost → staging replaces remote files and database. Continue?`)
      ) {
        return;
      }
      if (activeEnv === "staging" && !host) {
        window.alert("Set staging.host in config before full-site sync.");
        return;
      }
    }

    if (onBeforeRun) {
      const ok = await onBeforeRun();
      if (!ok) return;
    }

    const action: TerminalAction =
      activeDirection === "push"
        ? dryRun
          ? "wpdev_push_dry"
          : "wpdev_push"
        : dryRun
          ? "wpdev_pull_dry"
          : "wpdev_pull";

    const label =
      (dryRun ? "Preview: " : "") +
      (activeDirection === "push"
        ? `Push localhost → ${activeEnv}`
        : `Pull ${activeEnv} → localhost`);

    logAdmin("info", "SyncDeployPanel: start", `${label} dryRun=${dryRun}`);
    const args: Record<string, string> = { env: activeEnv };
    if (!dryRun && activeEnv === "production") {
      args.confirm = "SYNC_PRODUCTION";
    }
    if (!dryRun && activeEnv === "staging") {
      args.confirm = hosts.staging;
    }
    const result = await run(action, args, label);
    if (!result.ok && !dryRun) {
      logAdmin("error", "SyncDeployPanel: failed", result.output.slice(0, 200));
    }
  };

  const primaryLabel =
    activeDirection === "push"
      ? `Push localhost → ${activeEnv}`
      : `Pull ${activeEnv} → localhost`;

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
      <div>
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>
        <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
          Runs on your machine via the host runner — no terminal paste required. Live output below.
        </p>
        {hint ? <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{hint}</p> : null}
      </div>

      <div
        className={`rounded border px-3 py-2 text-xs ${
          canRun
            ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40"
            : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40"
        }`}
      >
        {canRun ? "Ready — click the button below to start." : runnerMessage}
      </div>

      {!fixedDirection && directions.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {directions.map((d) => (
            <button
              key={d}
              type="button"
              disabled={busy}
              onClick={() => setDirection(d)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize ${toggleButtonClass(activeDirection === d)}`}
            >
              {d}
            </button>
          ))}
        </div>
      ) : null}

      {!fixedEnv && envChoices.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {envChoices.map((e) => (
            <button
              key={e}
              type="button"
              disabled={busy}
              onClick={() => setEnv(e)}
              className={`rounded-lg px-3 py-1.5 text-xs capitalize ${toggleButtonClass(activeEnv === e)}`}
            >
              {e}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          disabled={busy || !canRun}
          onClick={() => void runDeploy(false)}
          className="flex-1 rounded-lg bg-brand-600 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Working…" : primaryLabel}
        </button>
        <button
          type="button"
          disabled={busy || !canRun}
          onClick={() => void runDeploy(true)}
          className="rounded-lg border border-slate-300 px-4 py-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Dry-run preview
        </button>
      </div>

      <JobProgressPanel job={job} outputRef={outputRef} onStop={() => void cancel()} />
    </section>
  );
}

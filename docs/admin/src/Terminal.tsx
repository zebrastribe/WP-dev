import { useState } from "react";
import { useRunnerJob } from "./useRunnerJob";
import { useRunnerSecrets } from "./useRunnerSecrets";
import { TerminalEmbed } from "./TerminalEmbed";
import { outlineButtonClass, toggleButtonClass } from "./uiClasses";

type EnvName = "local" | "staging" | "production";

export function TerminalTab() {
  const { terminalAuth, terminalPort, runnerReady, runnerMessage, canRun } = useRunnerSecrets();
  const { job, run, cancel, reset, outputRef, isRunning } = useRunnerJob("terminal", canRun);
  const [env, setEnv] = useState<EnvName>("staging");

  const envLabel = env === "local" ? "Dev" : env === "staging" ? "Staging" : "Production";
  const backupKind = env === "local" ? "full" : "db";

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Terminal</h2>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Doctor, SSH key, and backups for the selected environment. Full-site push/pull lives under{" "}
        <strong>Sync</strong> (theme-only by default; staging full-site after preview).
      </p>

      <div
        className={`rounded border px-3 py-2 text-xs ${
          runnerReady
            ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100"
            : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
        }`}
      >
        {runnerMessage || "Loading terminal settings..."}
      </div>

      <TerminalEmbed
        terminalPort={terminalPort}
        terminalAuth={terminalAuth}
        secretsReady={runnerReady}
        secretsError={runnerReady ? undefined : runnerMessage}
        title="Interactive shell (optional)"
        subtitle="Open only when you need manual commands; quick actions run below either way."
      />

      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["local", "Dev"],
            ["staging", "Staging"],
            ["production", "Production"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setEnv(value)}
            className={`rounded-lg px-3 py-1.5 text-xs ${toggleButtonClass(env === value)}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={isRunning || !canRun}
          onClick={() => void run("generate_keypair", undefined, "Generate SSH keypair")}
          className={`rounded-lg px-3 py-1.5 text-xs ${outlineButtonClass}`}
        >
          Generate SSH keypair
        </button>
        <button
          type="button"
          disabled={isRunning || !canRun || env === "local"}
          onClick={() => void run("wpdev_doctor", { env }, `Doctor ${envLabel}`)}
          className={`rounded-lg px-3 py-1.5 text-xs disabled:opacity-50 ${outlineButtonClass}`}
        >
          Run doctor {env === "local" ? "(pick Staging/Production)" : envLabel}
        </button>
        <button
          type="button"
          disabled={isRunning || !canRun}
          onClick={() =>
            void run(
              "backup_create",
              { env, kind: backupKind },
              `Backup ${envLabel} (${backupKind === "full" ? "DB + files" : "database"})`,
            )
          }
          className={`rounded-lg px-3 py-1.5 text-xs ${outlineButtonClass}`}
        >
          Backup {envLabel} ({backupKind === "full" ? "full" : "database"})
        </button>
        <button
          type="button"
          disabled={isRunning || !canRun}
          onClick={() =>
            void run("backup_list", { env, kind: backupKind }, `List ${envLabel} backups`)
          }
          className={`rounded-lg px-3 py-1.5 text-xs ${outlineButtonClass}`}
        >
          List {envLabel} backups
        </button>
      </div>

      <div className="space-y-2">
        {job.phase === "running" ? (
          <button
            type="button"
            onClick={() => void cancel()}
            className={`rounded-lg px-3 py-1.5 text-xs ${outlineButtonClass}`}
          >
            Stop
          </button>
        ) : null}
        {job.label ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {job.label}
            {job.phase === "success"
              ? " — done"
              : job.phase === "error"
                ? ` — ${job.error ?? "failed"}`
                : job.phase === "cancelled"
                  ? " — stopped"
                  : job.phase === "running"
                    ? " — running…"
                    : ""}
          </p>
        ) : null}
        <pre
          ref={outputRef}
          className="max-h-80 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] dark:border-slate-700 dark:bg-slate-950"
        >
          {job.output || "No command output yet."}
        </pre>
        {job.phase !== "idle" && job.phase !== "running" ? (
          <button type="button" className="text-xs text-slate-500 underline" onClick={reset}>
            Clear log
          </button>
        ) : null}
      </div>
    </div>
  );
}

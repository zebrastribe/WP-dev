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

  const envLabel = env === "local" ? "Local" : env === "staging" ? "Staging" : "Production";
  const backupKind = "complete";

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Terminal</h2>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        The public key is read from this computer (<code>~/.ssh/id_ed25519.pub</code>). Doctor and backups run in the project runner for the environment you pick. Full-site push/pull lives under{" "}
        <strong>Sync</strong>.
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
        subtitle="A shell inside the project runner. It is not where the SSH key is stored. Create the key on this computer."
      />

      <div className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <p className="text-xs text-slate-600 dark:text-slate-400">
          Create the key on this computer if it is missing:{" "}
          <code>ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -C &quot;you@host&quot;</code>
        </p>
        <button
          type="button"
          disabled={isRunning || !canRun}
          onClick={() => void run("generate_keypair", undefined, "Show SSH public key")}
          className={`rounded-lg px-3 py-1.5 text-xs ${outlineButtonClass}`}
        >
          Show SSH public key
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["local", "Local"],
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
      <p className="text-xs text-slate-500 dark:text-slate-400">These actions use the environment selected above.</p>

      <div className="flex flex-wrap gap-2">
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
              `Backup ${envLabel} (complete)`,
            )
          }
          className={`rounded-lg px-3 py-1.5 text-xs ${outlineButtonClass}`}
        >
          Backup {envLabel} (complete)
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

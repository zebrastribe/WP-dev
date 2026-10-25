import { useState } from "react";
import {
  JobProgressPanel,
  useRunnerJob,
  useRunnerSecrets,
} from "@wpdev/web-host";
import { RUNNER_ENV_LABEL, type RunnerEnv } from "../adapter/types";
import { LockedGate } from "../LockedGate";
import { secondaryAccentButtonClass } from "../uiClasses";
import { RestorePanel } from "./RestorePanel";

export type BackupKind = "db" | "full" | "complete";

const KIND_LABEL: Record<BackupKind, string> = {
  db: "Database",
  full: "Content",
  complete: "Complete",
};

/**
 * Primary Backup: env + kind (Database | Content | Complete); restore on this page.
 */
export function BackupPage() {
  const { canRun } = useRunnerSecrets("Unlock admin to back up your sites.");
  const { job, run, cancel, outputRef, reset } = useRunnerJob("terminal", canRun);
  const [env, setEnv] = useState<RunnerEnv>("local");
  const [kind, setKind] = useState<BackupKind>("complete");
  const [showRestore, setShowRestore] = useState(false);

  const backupNow = async () => {
    await run(
      "backup_create",
      { env, kind },
      `Backup ${RUNNER_ENV_LABEL[env]} (${KIND_LABEL[kind]})`,
    );
  };

  const listBackups = async () => {
    await run(
      "backup_list",
      { env, kind },
      `List ${KIND_LABEL[kind]} backups (${RUNNER_ENV_LABEL[env]})`,
    );
  };

  const restore = async (file: string, confirm: string) => {
    await run(
      "restore_env",
      { env, file, confirm },
      `Restore ${RUNNER_ENV_LABEL[env]}`,
    );
  };

  const busy = job.phase === "running";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Backup</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Snapshots for Local, Staging, and Production. Use <strong>Complete</strong> before WordPress,
          theme, plugin, or PHP updates so you can roll the whole install back if something breaks.
        </p>
      </div>

      <LockedGate message="Unlock admin to back up your sites.">
        <fieldset className="space-y-2">
          <legend className="text-xs font-bold uppercase tracking-wide text-brand-600 dark:text-brand-400">
            Environment
          </legend>
          <div className="flex flex-wrap gap-2">
            {(["local", "staging", "production"] as const).map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setEnv(e)}
                className={`rounded-lg px-4 py-2 text-sm font-semibold ${
                  env === e
                    ? "bg-brand-600 text-white"
                    : "border border-slate-300 dark:border-slate-600"
                }`}
              >
                {RUNNER_ENV_LABEL[e]}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="mt-4 space-y-2">
          <legend className="text-xs font-bold uppercase tracking-wide text-brand-600 dark:text-brand-400">
            Backup type
          </legend>
          <div className="flex flex-wrap gap-2">
            {(["db", "full", "complete"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`rounded-lg px-4 py-2 text-sm font-semibold ${
                  kind === k
                    ? "bg-brand-600 text-white"
                    : "border border-slate-300 dark:border-slate-600"
                }`}
              >
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            {kind === "db"
              ? "SQL dump only — fast, restores database state."
              : kind === "full"
                ? "Database + wp-content (themes, plugins, uploads)."
                : "Database + entire WordPress tree (core, themes, plugins). Excludes wp-config.php. Best before updates."}
          </p>
        </fieldset>

        <div className="mt-4 flex flex-wrap items-center gap-4">
          <button
            type="button"
            disabled={!canRun || busy}
            className={`${secondaryAccentButtonClass} rounded-lg px-5 py-2.5 text-sm disabled:opacity-50`}
            onClick={() => void backupNow()}
          >
            Backup now
          </button>
          <button
            type="button"
            disabled={!canRun || busy}
            className="text-sm text-slate-600 underline disabled:opacity-50 dark:text-slate-400"
            onClick={() => void listBackups()}
          >
            List recent
          </button>
        </div>

        <div className="mt-4">
          <JobProgressPanel
            job={job}
            outputRef={outputRef}
            onStop={busy ? () => void cancel() : undefined}
          />
          {job.phase !== "idle" && job.phase !== "running" ? (
            <button type="button" className="mt-2 text-xs text-slate-500 underline" onClick={reset}>
              Clear log
            </button>
          ) : null}
        </div>

        <details
          className="mt-6 rounded-lg border border-slate-200 p-3 dark:border-slate-700"
          open={showRestore}
          onToggle={(e) => setShowRestore((e.target as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer text-sm font-semibold text-slate-800 dark:text-slate-100">
            Restore from a backup
          </summary>
          <div className="mt-3">
            <RestorePanel
              env={env}
              busy={busy}
              canRun={canRun}
              onRestore={restore}
            />
          </div>
        </details>
      </LockedGate>
    </div>
  );
}

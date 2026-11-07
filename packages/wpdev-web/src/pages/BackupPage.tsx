import { useRef, useState } from "react";
import {
  importLocalBackup,
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
  const [importName, setImportName] = useState("");
  const [importError, setImportError] = useState("");
  const importRef = useRef<HTMLInputElement>(null);

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

  const importDownloaded = async () => {
    const file = importRef.current?.files?.[0];
    if (!file) return;
    const cloudSetup = file.name.startsWith("wp-dev-local-setup") && file.name.endsWith(".tar.gz");
    const message = cloudSetup
      ? `Import ${file.name} onto Local?\n\nThis replaces the local database and wp-content, then points the site URL at this computer.`
      : `Import ${file.name} onto Local?\n\nThis replaces the current Local site state.`;
    if (!window.confirm(message)) return;
    setImportError("");
    const uploaded = await importLocalBackup(file);
    if (!uploaded.ok) {
      setImportError(uploaded.error);
      return;
    }
    if (cloudSetup) {
      await run("setup_from_backup", { file: uploaded.path }, `Import ${file.name} into Local`);
    } else {
      await run(
        "restore_env",
        { env: "local", file: uploaded.path, confirm: "" },
        `Import ${file.name} into Local`,
      );
    }
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

        <fieldset className="mt-6 space-y-2 rounded-lg border border-slate-200 p-4 dark:border-slate-700">
          <legend className="px-1 text-xs font-bold uppercase tracking-wide text-brand-600 dark:text-brand-400">
            Import a downloaded file
          </legend>
          {env === "local" ? (
            <>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Choose the compressed backup you downloaded from WP-dev Cloud, or any .sql / .tar.gz backup.
                Import saves it into this project and loads it onto Local.
              </p>
              <input
                ref={importRef}
                type="file"
                accept=".sql,.tar.gz,application/gzip,application/x-gzip"
                className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-brand-700"
                onChange={(e) => {
                  setImportName(e.target.files?.[0]?.name ?? "");
                  setImportError("");
                }}
              />
              {importError ? (
                <p className="text-sm text-amber-800 dark:text-amber-200">{importError}</p>
              ) : null}
              <button
                type="button"
                disabled={!canRun || busy || importName === ""}
                className={`${secondaryAccentButtonClass} rounded-lg px-5 py-2.5 text-sm disabled:opacity-50`}
                onClick={() => void importDownloaded()}
              >
                Import into Local
              </button>
            </>
          ) : (
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Switch the environment to Local to import a downloaded file onto this computer.
            </p>
          )}
        </fieldset>

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

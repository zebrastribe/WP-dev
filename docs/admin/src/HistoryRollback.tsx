import { useEffect, useState } from "react";
import { getTerminalJobStatus, runTerminalAction } from "./api";
import { useRunnerSecrets } from "./useRunnerSecrets";

type EnvName = "local" | "staging" | "production";
type BackupKind = "full" | "db";

export function HistoryRollback() {
  const { runnerReady, runnerMessage, canRun } = useRunnerSecrets();
  const [env, setEnv] = useState<EnvName>("staging");
  const [kind, setKind] = useState<BackupKind>("full");
  const [selectedBackup, setSelectedBackup] = useState("");
  const [productionConfirm, setProductionConfirm] = useState("");
  const [backups, setBackups] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState("");
  const [loadingBackups, setLoadingBackups] = useState(false);

  const run = async (action: "backup_create" | "backup_list" | "restore_env", args: Record<string, string>) => {
    if (!canRun) {
      setOutput("Unlock admin and wait for runner to be ready.");
      return;
    }
    setBusy(true);
    setOutput("Starting command...\n");
    try {
      const started = await runTerminalAction(action, args);
      if (!started.ok) {
        setOutput(
          started.error === "runner_secrets_unavailable"
            ? "Runner credentials are missing on backend. Run: npm run wp-dev -- up"
            : `Runner error: ${started.error}`,
        );
        return;
      }
      for (let i = 0; i < 300; i += 1) {
        const st = await getTerminalJobStatus(started.jobId);
        if (!st.ok) {
          setOutput(`Status error: ${st.error}`);
          return;
        }
        const txt = st.output || "Running...";
        setOutput(txt);
        if (st.status === "done") {
          if (action === "backup_list") {
            const parsed = txt
              .split("\n")
              .map((x) => x.trim())
              .filter((x) => x.length > 0 && x.startsWith("/"));
            setBackups(parsed);
            if (parsed.length > 0 && !selectedBackup) setSelectedBackup(parsed[0]!);
          }
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
      }
    } finally {
      setBusy(false);
    }
  };

  const runRestoreWithSafetySnapshot = async () => {
    if (!selectedBackup) {
      setOutput("Select a restore point first.");
      return;
    }
    if (!canRun) {
      setOutput("Set terminal auth and runner token first.");
      return;
    }
    setBusy(true);
    setOutput("Creating pre-restore safety snapshot...\n");
    try {
      const pre = await runTerminalAction("backup_create", {
        env,
        kind,
      });
      if (!pre.ok) {
        setOutput(`Could not create pre-restore snapshot: ${pre.error}`);
        return;
      }
      for (let i = 0; i < 300; i += 1) {
        const st = await getTerminalJobStatus(pre.jobId);
        if (!st.ok) {
          setOutput(`Pre-restore snapshot status error: ${st.error}`);
          return;
        }
        const txt = st.output || "Running...";
        setOutput(`Creating pre-restore safety snapshot...\n\n${txt}`);
        if (st.status === "done") {
          if (st.exitCode !== 0) {
            setOutput(
              `Pre-restore safety snapshot failed (restore canceled).\n\n${txt || "No output."}`,
            );
            return;
          }
          break;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
      }
    } finally {
      setBusy(false);
    }

    await run("restore_env", {
      env,
      file: selectedBackup,
      confirm: env === "production" ? productionConfirm : "",
    });
  };

  const refreshBackups = async () => {
    setLoadingBackups(true);
    try {
      await run("backup_list", { env, kind });
    } finally {
      setLoadingBackups(false);
    }
  };

  useEffect(() => {
    if (!canRun) return;
    void refreshBackups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [env, kind, canRun]);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Site Restore Points</h2>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Roll back WordPress site state by restoring database/file snapshots for local, staging, or production.
      </p>

      <div
        className={`rounded border px-3 py-2 text-xs ${
          runnerReady
            ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100"
            : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
        }`}
      >
        {runnerMessage || "Loading runner security settings..."}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(["local", "staging", "production"] as const).map((x) => (
          <button
            key={x}
            type="button"
            onClick={() => setEnv(x)}
            className={`rounded-lg px-3 py-1.5 text-xs ${
              env === x ? "bg-brand-600 text-white" : "border border-slate-300"
            }`}
          >
            {x}
          </button>
        ))}
        <div className="inline-flex rounded-lg border border-slate-300 dark:border-slate-600">
          <button
            type="button"
            onClick={() => setKind("full")}
            className={`px-3 py-1.5 text-xs ${kind === "full" ? "bg-brand-600 text-white" : "bg-white dark:bg-slate-800"}`}
          >
            Full (DB + files)
          </button>
          <button
            type="button"
            onClick={() => setKind("db")}
            className={`px-3 py-1.5 text-xs ${kind === "db" ? "bg-brand-600 text-white" : "bg-white dark:bg-slate-800"}`}
          >
            DB only
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">Restore point timeline</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || !canRun}
            onClick={() => void run("backup_create", { env, kind })}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800"
          >
            Create restore point now
          </button>
          <button
            type="button"
            disabled={busy || !canRun || loadingBackups}
            onClick={() => void refreshBackups()}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800"
          >
            {loadingBackups ? "Loading..." : "Refresh restore points"}
          </button>
        </div>
        <select
          className="mt-3 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
          value={selectedBackup}
          onChange={(e) => setSelectedBackup(e.target.value)}
        >
          <option value="">Select a restore point</option>
          {backups.map((entry) => (
            <option key={entry} value={entry}>
              {entry}
            </option>
          ))}
        </select>
      </div>

      {env === "production" && (
        <div className="rounded-lg border border-amber-300 p-3 dark:border-amber-700">
          <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
            Production restore confirmation
          </p>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
            Type RESTORE_PRODUCTION to confirm restoring production from selected restore point.
          </p>
          <input
            className="mt-2 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm dark:border-amber-700 dark:bg-slate-900"
            value={productionConfirm}
            onChange={(e) => setProductionConfirm(e.target.value)}
            placeholder="RESTORE_PRODUCTION"
          />
        </div>
      )}

      <div className="rounded-lg border border-red-300 p-3 dark:border-red-700">
        <p className="text-xs font-semibold text-red-700 dark:text-red-300">Rollback selected restore point</p>
        <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
          This replaces current site state in {env}. A pre-restore safety snapshot is created automatically before restore.
        </p>
        <button
          type="button"
          disabled={
            busy ||
            !canRun ||
            !selectedBackup ||
            (env === "production" && productionConfirm !== "RESTORE_PRODUCTION")
          }
          onClick={() => void runRestoreWithSafetySnapshot()}
          className="mt-2 rounded-lg bg-red-600 px-3 py-1.5 text-xs text-white disabled:opacity-50"
        >
          Restore {env} now
        </button>
      </div>

      <pre className="max-h-96 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] dark:border-slate-700 dark:bg-slate-950">
        {output || "No output yet."}
      </pre>
    </div>
  );
}

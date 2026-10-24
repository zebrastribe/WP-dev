import { useEffect, useRef, useState } from "react";
import { getTerminalJobStatus, loadWpDevConfig, runTerminalAction } from "./api";
import { useRunnerSecrets } from "./useRunnerSecrets";

type EnvName = "local" | "staging" | "production";
type BackupKind = "full" | "db";

const ENV_LABEL: Record<EnvName, string> = {
  local: "Dev",
  staging: "Staging",
  production: "Production",
};

function backupPathMatchesEnv(path: string, env: EnvName): boolean {
  // Paths look like ~/.wp-dev/backups/<project>/<env>/...
  return /(?:^|\/)\.wp-dev\/backups\/[^/]+\/([^/]+)\//.test(path)
    ? path.includes(`/.wp-dev/backups/`) && path.includes(`/${env}/`)
    : path.includes(`/${env}/`);
}

export function HistoryRollback() {
  const { runnerReady, runnerMessage, canRun } = useRunnerSecrets();
  const [env, setEnv] = useState<EnvName>("local");
  const [kind, setKind] = useState<BackupKind>("db");
  const [selectedBackup, setSelectedBackup] = useState("");
  const [productionConfirm, setProductionConfirm] = useState("");
  const [backups, setBackups] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState("");
  const [loadingBackups, setLoadingBackups] = useState(false);
  const listRequestId = useRef(0);

  const run = async (
    action: "backup_create" | "backup_list" | "restore_env",
    args: Record<string, string>,
    opts?: { listReqId?: number },
  ) => {
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
      for (let i = 0; i < 1800; i += 1) {
        if (opts?.listReqId != null && opts.listReqId !== listRequestId.current) {
          return;
        }
        const st = await getTerminalJobStatus(started.jobId);
        if (!st.ok) {
          setOutput(`Status error: ${st.error}`);
          return;
        }
        const txt = st.output || "Running...";
        setOutput(txt);
        if (st.status === "done") {
          if (action === "backup_list") {
            if (opts?.listReqId != null && opts.listReqId !== listRequestId.current) {
              return;
            }
            const listEnv = (args.env as EnvName) || env;
            const parsed = txt
              .split("\n")
              .map((x) => x.trim())
              .filter((x) => x.length > 0 && x.startsWith("/"))
              .filter((x) => backupPathMatchesEnv(x, listEnv))
              // Staging/Production full .tar.gz cannot be restored via the UI runner yet.
              .filter((x) => listEnv === "local" || !x.endsWith(".tar.gz"));
            setBackups(parsed);
            setSelectedBackup("");
          }
          return;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
      }
      setOutput((prev) => `${prev}\n\nTimed out waiting for runner (30 min).`);
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
    if (!backupPathMatchesEnv(selectedBackup, env)) {
      setOutput(
        `Selected file is not under the ${ENV_LABEL[env]} backup folder. Refresh restore points and pick again.`,
      );
      return;
    }
    if (env !== "local" && selectedBackup.endsWith(".tar.gz")) {
      setOutput(
        "Full archive (.tar.gz) restore to Staging/Production is not available in the browser. Use a .sql backup, or restore Dev full archives only.",
      );
      return;
    }
    if (
      !window.confirm(
        `Restore ${ENV_LABEL[env]} from:\n${selectedBackup}\n\nThis replaces the current site state. Continue?`,
      )
    ) {
      return;
    }
    setBusy(true);
    setOutput("Creating pre-restore safety snapshot...\n");
    let snapshotOk = false;
    try {
      const pre = await runTerminalAction("backup_create", {
        env,
        kind: env === "local" ? kind : "db",
      });
      if (!pre.ok) {
        setOutput(`Could not create pre-restore snapshot: ${pre.error}`);
        return;
      }
      for (let i = 0; i < 1800; i += 1) {
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
          snapshotOk = true;
          break;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
      }
      if (!snapshotOk) {
        setOutput("Pre-restore safety snapshot timed out — restore canceled.");
        return;
      }
    } finally {
      setBusy(false);
    }

    let stagingHost = "";
    if (env === "staging") {
      const cfg = await loadWpDevConfig();
      stagingHost = String((cfg?.staging as { host?: string } | undefined)?.host ?? "").trim();
      if (!stagingHost) {
        setOutput("Set staging.host in config before restoring Staging.");
        return;
      }
    }
    await run("restore_env", {
      env,
      file: selectedBackup,
      confirm: env === "production" ? productionConfirm : env === "staging" ? stagingHost : "",
    });
  };

  const refreshBackups = async () => {
    const reqId = ++listRequestId.current;
    setLoadingBackups(true);
    setSelectedBackup("");
    setBackups([]);
    try {
      await run("backup_list", { env, kind }, { listReqId: reqId });
    } finally {
      if (reqId === listRequestId.current) setLoadingBackups(false);
    }
  };

  useEffect(() => {
    setSelectedBackup("");
    setBackups([]);
    setProductionConfirm("");
    if (env !== "local" && kind === "full") {
      setKind("db");
      return;
    }
    if (!canRun) return;
    void refreshBackups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [env, kind, canRun]);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Restore points</h2>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Database snapshots for Dev, Staging, and Production. Full file archives (DB + wp-content) are Dev-only in this UI.
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
            {ENV_LABEL[x]}
          </button>
        ))}
        <div className="inline-flex rounded-lg border border-slate-300 dark:border-slate-600">
          <button
            type="button"
            disabled={env !== "local"}
            title={env !== "local" ? "Full archives are Dev-only in this UI" : undefined}
            onClick={() => setKind("full")}
            className={`px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40 ${kind === "full" ? "bg-brand-600 text-white" : "bg-white dark:bg-slate-800"}`}
          >
            Full (DB + files)
          </button>
          <button
            type="button"
            onClick={() => setKind("db")}
            className={`px-3 py-1.5 text-xs ${kind === "db" ? "bg-brand-600 text-white" : "bg-white dark:bg-slate-800"}`}
          >
            Database
          </button>
        </div>
      </div>
      {env !== "local" ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Staging/Production restore uses database snapshots only (same as Backup → Database only).
        </p>
      ) : null}

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
          This replaces current site state in {ENV_LABEL[env]}. A pre-restore safety snapshot is created automatically before restore.
        </p>
        <button
          type="button"
          disabled={
            busy ||
            !canRun ||
            !selectedBackup ||
            !backupPathMatchesEnv(selectedBackup, env) ||
            (env === "production" && productionConfirm !== "RESTORE_PRODUCTION")
          }
          onClick={() => void runRestoreWithSafetySnapshot()}
          className="mt-2 rounded-lg bg-red-600 px-3 py-1.5 text-xs text-white disabled:opacity-50"
        >
          {selectedBackup ? `Restore ${ENV_LABEL[env]} now` : "Nothing selected"}
        </button>
      </div>

      <pre className="max-h-96 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] dark:border-slate-700 dark:bg-slate-950">
        {output || "No output yet."}
      </pre>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import {
  getTerminalJobStatus,
  loadTerminalRunnerSecrets,
  readStoredAdminSaveToken,
  runTerminalAction,
  writeStoredAdminSaveToken,
} from "./api";

type EnvName = "local" | "staging" | "production";
type BackupKind = "db" | "full";

export function BackupRestore() {
  const [terminalAuth, setTerminalAuth] = useState("");
  const [runnerToken, setRunnerToken] = useState("");
  const [env, setEnv] = useState<EnvName>("local");
  const [backupKind, setBackupKind] = useState<BackupKind>("full");
  const [restoreFile, setRestoreFile] = useState("");
  const [productionConfirm, setProductionConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState("");
  const [runnerReady, setRunnerReady] = useState(false);
  const [runnerMessage, setRunnerMessage] = useState<string>("");
  const [adminSaveToken, setAdminSaveToken] = useState(readStoredAdminSaveToken);

  const canRun = useMemo(
    () => Boolean(terminalAuth.trim() && runnerToken.trim()),
    [terminalAuth, runnerToken],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await loadTerminalRunnerSecrets(adminSaveToken.trim() || undefined);
      if (cancelled) return;
      if (!res.ok) {
        const forbiddenHint =
          res.error === "forbidden"
            ? " Enter WPDEV_ADMIN_SAVE_TOKEN below (stored in this browser for Terminal / Backup tabs)."
            : "";
        const startupHint =
          res.error === "not_found"
            ? "This admin API is outdated. Run: npm run admin:build:wp && npm run wp-dev -- down && npm run wp-dev -- up (in the same clone)."
            : res.error === "forbidden"
              ? ""
              : "Run: npm run wp-dev -- up";
        setRunnerReady(false);
        setRunnerMessage(
          `Runner credentials are not initialized yet (${res.error}${res.detail ? `: ${res.detail}` : ""}).${forbiddenHint} ${startupHint}`.trim(),
        );
        return;
      }
      setTerminalAuth(res.terminalAuth);
      setRunnerToken(res.runnerToken);
      setRunnerReady(true);
      setRunnerMessage("Runner security is loaded automatically from backend.");
    })();
    return () => {
      cancelled = true;
    };
  }, [adminSaveToken]);

  const runAction = async (action: "backup_create" | "backup_list" | "restore_env", args: Record<string, string>) => {
    if (!canRun) {
      setOutput("Set terminal auth and runner token first.");
      return;
    }
    setBusy(true);
    setOutput("Starting command...\n");
    try {
      const started = await runTerminalAction(terminalAuth.trim(), runnerToken.trim(), action, args);
      if (!started.ok) {
        setOutput(
          started.error === "missing_runner_token"
            ? "Runner credentials are missing on backend. Run: npm run wp-dev -- up"
            : `Runner error: ${started.error}`,
        );
        return;
      }
      for (let i = 0; i < 300; i += 1) {
        const st = await getTerminalJobStatus(terminalAuth.trim(), runnerToken.trim(), started.jobId);
        if (!st.ok) {
          setOutput(`Status error: ${st.error}`);
          return;
        }
        const txt = st.output || "Running...";
        if (st.status === "done" && st.exitCode !== null && st.exitCode !== 0) {
          if (
            action === "backup_create" &&
            args.env === "local" &&
            (txt.includes("Local WordPress is not installed") ||
              txt.includes("assertLocalWpInstalled") ||
              txt.includes("backup local"))
          ) {
            setOutput(
              "Cannot create local backup yet: local WordPress is not installed for this project.\n" +
                "Run wp-dev up and complete /wp-admin/install.php (or pull from remote), then try backup again.\n\n" +
                "Tip: you can use pull production/staging first, then retry backup.",
            );
            return;
          }
        }
        if (st.status === "done" && action === "backup_list" && (!st.output || !st.output.trim())) {
          setOutput("No backups found for this environment yet.");
          return;
        }
        setOutput(txt);
        if (st.status === "done") return;
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Backup / Restore</h2>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Create/list/restore backups. Full backup includes database + wp-content files.
      </p>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        For staging/production full backup/restore, remote host must support SSH access and have WP-CLI + rsync available.
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

      <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900/40">
        <label className="block font-medium text-slate-700 dark:text-slate-300">
          Admin save token (only if WPDEV_ADMIN_SAVE_TOKEN is set in docker/.env)
        </label>
        <input
          type="password"
          autoComplete="off"
          value={adminSaveToken}
          onChange={(e) => {
            const v = e.target.value;
            setAdminSaveToken(v);
            writeStoredAdminSaveToken(v);
          }}
          className="mt-1 w-full max-w-md rounded border border-slate-300 bg-white px-2 py-1 dark:border-slate-600 dark:bg-slate-950"
          placeholder="Paste token to load runner secrets from the API"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(["local", "staging", "production"] as const).map((x) => (
          <button
            key={x}
            type="button"
            onClick={() => setEnv(x)}
            className={`rounded-lg px-3 py-1.5 text-xs ${env === x ? "bg-brand-600 text-white" : "border border-slate-300"}`}
          >
            {x}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="inline-flex rounded-lg border border-slate-300 dark:border-slate-600">
          <button
            type="button"
            onClick={() => setBackupKind("full")}
            className={`px-3 py-1.5 text-xs ${backupKind === "full" ? "bg-brand-600 text-white" : "bg-white dark:bg-slate-800"}`}
          >
            Full (DB + files)
          </button>
          <button
            type="button"
            onClick={() => setBackupKind("db")}
            className={`px-3 py-1.5 text-xs ${backupKind === "db" ? "bg-brand-600 text-white" : "bg-white dark:bg-slate-800"}`}
          >
            Database only
          </button>
        </div>
        <button
          type="button"
          disabled={busy || !canRun}
          onClick={() => void runAction("backup_create", { env, kind: backupKind })}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800"
        >
          {busy ? "Running..." : `Create ${env} ${backupKind === "full" ? "full" : "database"} backup`}
        </button>
        <button
          type="button"
          disabled={busy || !canRun}
          onClick={() => void runAction("backup_list", { env, kind: backupKind })}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800"
        >
          List {env} {backupKind === "full" ? "full" : "database"} backups
        </button>
      </div>

      <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">Restore</p>
        <label className="mt-2 block">
          <span className="text-xs text-slate-600 dark:text-slate-400">Backup file path</span>
          <input
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            value={restoreFile}
            onChange={(e) => setRestoreFile(e.target.value)}
            placeholder="e.g. /root/.wp-dev/backups/my-site/local/2026-05-05_13-00-00.sql"
          />
        </label>
        {env === "production" && (
          <label className="mt-2 block">
            <span className="text-xs text-amber-700 dark:text-amber-300">
              Type RESTORE_PRODUCTION to confirm destructive production restore
            </span>
            <input
              className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm dark:border-amber-700 dark:bg-slate-900"
              value={productionConfirm}
              onChange={(e) => setProductionConfirm(e.target.value)}
            />
          </label>
        )}
        <button
          type="button"
          disabled={
            busy ||
            !canRun ||
            !restoreFile.trim() ||
            (env === "production" && productionConfirm !== "RESTORE_PRODUCTION")
          }
          onClick={() =>
            void runAction("restore_env", {
              env,
              file: restoreFile.trim(),
              confirm: env === "production" ? productionConfirm.trim() : "",
            })
          }
          className="mt-2 rounded-lg bg-red-600 px-3 py-1.5 text-xs text-white disabled:opacity-50"
        >
          Restore {env} from file
        </button>
      </div>

      <pre className="max-h-80 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] dark:border-slate-700 dark:bg-slate-950">
        {output || "No command output yet."}
      </pre>
    </div>
  );
}

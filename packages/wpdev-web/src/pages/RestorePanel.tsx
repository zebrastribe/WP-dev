import { useEffect, useState } from "react";
import { loadWpDevConfig } from "@wpdev/web-host";
import { RUNNER_ENV_LABEL, type RunnerEnv } from "../adapter/types";

type RestorePanelProps = {
  env: RunnerEnv;
  busy: boolean;
  canRun: boolean;
  onRestore: (file: string, confirm: string) => Promise<void>;
};

/** On-page restore: path + confirm only — shares env with Backup page. */
export function RestorePanel({ env, busy, canRun, onRestore }: RestorePanelProps) {
  const [file, setFile] = useState("");
  const [productionConfirm, setProductionConfirm] = useState("");
  const [stagingHost, setStagingHost] = useState("");

  useEffect(() => {
    setFile("");
    setProductionConfirm("");
  }, [env]);

  useEffect(() => {
    if (!canRun) return;
    let cancelled = false;
    void (async () => {
      const cfg = await loadWpDevConfig();
      if (cancelled || !cfg) return;
      const staging = cfg.staging as { host?: string } | undefined;
      setStagingHost(String(staging?.host ?? "").trim());
    })();
    return () => {
      cancelled = true;
    };
  }, [canRun]);

  const envLabel = RUNNER_ENV_LABEL[env];
  const isProduction = env === "production";
  const isStaging = env === "staging";
  const isRemote = env !== "local";
  const isFullArchive = file.trim().endsWith(".tar.gz");
  const remoteFullBlocked = isRemote && isFullArchive;

  const handleRestore = async () => {
    const path = file.trim();
    if (remoteFullBlocked) {
      window.alert(
        "Full archive (.tar.gz) restore to Staging/Production is not available here. Use a .sql database backup, or restore full archives on Dev only.",
      );
      return;
    }
    if (isStaging && !stagingHost) {
      window.alert("Set staging.host in config before restoring Staging.");
      return;
    }
    const hostLine = isStaging && stagingHost ? `SSH host: ${stagingHost}\n\n` : "";
    if (
      !window.confirm(
        `${hostLine}Restore ${envLabel} from:\n${path}\n\nThis replaces the current ${envLabel} site state. Continue?`,
      )
    ) {
      return;
    }
    const confirm = isProduction
      ? productionConfirm.trim()
      : isStaging
        ? stagingHost
        : "";
    await onRestore(path, confirm);
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Restores into <span className="font-medium text-slate-800 dark:text-slate-100">{envLabel}</span>{" "}
        from a backup file under this project. Staging/Production: <strong>.sql only</strong> in the
        browser. Dev can restore full <code className="text-xs">.tar.gz</code>. For a list, open
        Advanced → Restore points.
      </p>
      <label className="block">
        <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Backup file path</span>
        <input
          className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
          value={file}
          onChange={(e) => setFile(e.target.value)}
          placeholder="Path from List recent, or ~/.wp-dev/backups/&lt;project&gt;/…"
        />
      </label>
      {remoteFullBlocked ? (
        <p className="text-xs text-amber-800 dark:text-amber-200">
          This path looks like a full archive. Choose a .sql backup for {envLabel}, or switch env to
          Dev.
        </p>
      ) : null}
      {isProduction ? (
        <label className="block">
          <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
            Type RESTORE_PRODUCTION to confirm
          </span>
          <input
            className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm dark:border-amber-700 dark:bg-slate-900"
            value={productionConfirm}
            onChange={(e) => setProductionConfirm(e.target.value)}
          />
        </label>
      ) : null}
      <button
        type="button"
        disabled={
          busy ||
          !canRun ||
          !file.trim() ||
          remoteFullBlocked ||
          (isProduction && productionConfirm !== "RESTORE_PRODUCTION") ||
          (isStaging && !stagingHost)
        }
        className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        onClick={() => void handleRestore()}
      >
        Restore {envLabel}
      </button>
    </div>
  );
}

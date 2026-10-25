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
  const isArchive = file.trim().endsWith(".tar.gz");
  const archiveHint = isArchive
    ? file.includes("complete-")
      ? "complete install"
      : "content (DB + wp-content)"
    : "database";

  const handleRestore = async () => {
    const path = file.trim();
    if (isStaging && !stagingHost) {
      window.alert("Set staging.host in config before restoring Staging.");
      return;
    }
    const hostLine = isStaging && stagingHost ? `SSH host: ${stagingHost}\n\n` : "";
    if (
      !window.confirm(
        `${hostLine}Restore ${envLabel} (${archiveHint}) from:\n${path}\n\nThis replaces the current ${envLabel} site state. Live wp-config.php is kept on complete restores. Continue?`,
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
        from a backup under this project. Accepts <code className="text-xs">.sql</code> (database),{" "}
        <code className="text-xs">full-*.tar.gz</code> (content), and{" "}
        <code className="text-xs">complete-*.tar.gz</code> (whole install). Staging and Production need
        the confirm fields below. Use List recent to copy a path.
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

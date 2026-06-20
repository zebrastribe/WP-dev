import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getTerminalJobStatus,
  loadTerminalRunnerSecrets,
  readStoredAdminSaveToken,
  runTerminalAction,
  writeStoredAdminSaveToken,
} from "./api";

type UpdatePreflightJson = {
  preflight: {
    isGitRepo: boolean;
    upstream: string | null;
    dirtyCount: number;
    untrackedCount: number;
    commitsAhead: number | null;
    commitsBehind: number | null;
    forkWorkflowRecommended: boolean;
    warnings: string[];
  };
  wordpressSafe: boolean;
};

function parsePreflightJson(output: string): UpdatePreflightJson | null {
  const start = output.indexOf("{");
  if (start < 0) return null;
  try {
    return JSON.parse(output.slice(start)) as UpdatePreflightJson;
  } catch {
    return null;
  }
}

export function UpdateTab() {
  const [terminalAuth, setTerminalAuth] = useState("");
  const [runnerToken, setRunnerToken] = useState("");
  const [runnerReady, setRunnerReady] = useState(false);
  const [runnerMessage, setRunnerMessage] = useState("");
  const [adminSaveToken, setAdminSaveToken] = useState(readStoredAdminSaveToken);
  const [rebuildAdmin, setRebuildAdmin] = useState(true);
  const [restartStack, setRestartStack] = useState(true);
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState("");
  const [preflight, setPreflight] = useState<UpdatePreflightJson["preflight"] | null>(null);

  const canRun = useMemo(
    () => Boolean(runnerReady && terminalAuth.trim() && runnerToken.trim()),
    [runnerReady, terminalAuth, runnerToken],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await loadTerminalRunnerSecrets(adminSaveToken.trim() || undefined);
      if (cancelled) return;
      if (!res.ok) {
        setRunnerReady(false);
        setRunnerMessage(
          `Host runner not ready (${res.error}${res.detail ? `: ${res.detail}` : ""}). Run npm run wp-dev -- up in this clone.`,
        );
        return;
      }
      setTerminalAuth(res.terminalAuth);
      setRunnerToken(res.runnerToken);
      setRunnerReady(true);
      setRunnerMessage("Host runner ready. Update runs on your machine — wordpress/ site files are preserved.");
    })();
    return () => {
      cancelled = true;
    };
  }, [adminSaveToken]);

  const refreshPreflight = useCallback(async () => {
    if (!canRun) return;
    const started = await runTerminalAction(
      terminalAuth.trim(),
      runnerToken.trim(),
      "wpdev_update_preflight",
      {},
      "sync",
    );
    if (!started.ok) return;
    for (let i = 0; i < 60; i += 1) {
      const st = await getTerminalJobStatus(
        terminalAuth.trim(),
        runnerToken.trim(),
        started.jobId,
        "sync",
      );
      if (!st.ok || st.status === "done") {
        if (st.ok && st.output) {
          const parsed = parsePreflightJson(st.output);
          if (parsed?.preflight) setPreflight(parsed.preflight);
        }
        return;
      }
      await new Promise((r) => window.setTimeout(r, 500));
    }
  }, [canRun, runnerToken, terminalAuth]);

  useEffect(() => {
    if (canRun) void refreshPreflight();
  }, [canRun, refreshPreflight]);

  const runUpdate = useCallback(
    async (dryRun: boolean) => {
      if (!canRun) {
        setOutput("Runner is not ready yet.");
        return;
      }
      setBusy(true);
      setOutput(dryRun ? "Planning update…\n" : "Updating wp-dev…\n");
      try {
        const started = await runTerminalAction(
          terminalAuth.trim(),
          runnerToken.trim(),
          "wpdev_update",
          {
            admin: rebuildAdmin ? "1" : "0",
            restart: restartStack ? "1" : "0",
            dry_run: dryRun ? "1" : "0",
          },
          "sync",
        );
        if (!started.ok) {
          setOutput(`Runner error: ${started.error}`);
          return;
        }
        for (let i = 0; i < 900; i += 1) {
          const st = await getTerminalJobStatus(
            terminalAuth.trim(),
            runnerToken.trim(),
            started.jobId,
            "sync",
          );
          if (!st.ok) {
            setOutput(`Status error: ${st.error}`);
            return;
          }
          setOutput(st.output || "Running…");
          if (st.status === "done") {
            if (st.exitCode !== 0) {
              setOutput((prev) => `${prev}\n\nUpdate failed (exit ${st.exitCode ?? 1}).`);
            }
            return;
          }
          await new Promise((r) => window.setTimeout(r, 1000));
        }
        setOutput((prev) => `${prev}\n\nTimed out waiting for update.`);
      } finally {
        setBusy(false);
      }
    },
    [canRun, rebuildAdmin, restartStack, runnerToken, terminalAuth],
  );

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Update wp-dev</h2>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Pull the latest wp-dev tool from git, rebuild the CLI and admin UI, and restart the local stack.
        Your WordPress site in <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">wordpress/</code> is{" "}
        <strong>not</strong> replaced — only{" "}
        <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">wordpress/admin/</code> is refreshed when
        admin rebuild is enabled.
      </p>

      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
        <strong>Safe:</strong> themes, plugins, uploads, and your local database stay as they are. This is not{" "}
        <code className="rounded bg-emerald-100/80 px-1 dark:bg-emerald-900/60">pull</code> from staging/production.
      </div>

      <div
        className={`rounded border px-3 py-2 text-xs ${
          runnerReady
            ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100"
            : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
        }`}
      >
        {runnerMessage || "Loading runner…"}
      </div>

      {preflight ? (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            preflight.forkWorkflowRecommended
              ? "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
              : "border-slate-200 bg-slate-50 text-slate-800 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200"
          }`}
        >
          <p className="font-semibold">Pre-flight check</p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-xs">
            <li>Upstream: {preflight.upstream ?? "(none)"}</li>
            {preflight.commitsBehind != null ? (
              <li>Behind upstream: {preflight.commitsBehind} commit(s)</li>
            ) : null}
            {preflight.commitsAhead != null ? (
              <li>Ahead of upstream: {preflight.commitsAhead} commit(s)</li>
            ) : null}
            <li>Dirty tracked files: {preflight.dirtyCount}</li>
            <li>Untracked files: {preflight.untrackedCount}</li>
          </ul>
          {preflight.forkWorkflowRecommended ? (
            <p className="mt-2 text-xs">
              <strong>Fork detected:</strong> create a safety branch and merge upstream manually (see README
              “Fork updates”). Do not rely on Update alone. Never run <code>git clean -fd</code> mid-merge.
            </p>
          ) : null}
          {preflight.warnings.length > 0 ? (
            <ul className="mt-2 list-inside list-disc space-y-1 text-xs">
              {preflight.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}
          <p className="mt-2 text-xs">
            Back up gitignored config: wp-dev.config.json, docker/.env, and any project-specific secret files.
          </p>
        </div>
      ) : null}

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
          placeholder="Paste token to load runner secrets"
        />
      </div>

      <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4 text-sm dark:border-slate-800 dark:bg-slate-900/60">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={rebuildAdmin}
            onChange={(e) => setRebuildAdmin(e.target.checked)}
            disabled={busy}
          />
          Rebuild admin UI (<code className="text-xs">wordpress/admin/</code> only)
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={restartStack}
            onChange={(e) => setRestartStack(e.target.checked)}
            disabled={busy}
          />
          Restart Docker stack after update (<code className="text-xs">wp-dev down && up</code>)
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !canRun}
          onClick={() => void runUpdate(false)}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Updating…" : "Update wp-dev now"}
        </button>
        <button
          type="button"
          disabled={busy || !canRun}
          onClick={() => void runUpdate(true)}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm dark:border-slate-600"
        >
          Preview steps (dry run)
        </button>
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        CLI equivalent:{" "}
        <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">npm run wp-dev -- update</code>
      </p>

      <pre className="max-h-96 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] dark:border-slate-700 dark:bg-slate-950">
        {output || "No output yet."}
      </pre>
    </div>
  );
}

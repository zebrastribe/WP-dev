import { useState } from "react";
import { generateRunnerToken, getTerminalJobStatus, runTerminalAction, saveDockerEnvSecrets } from "./api";

export function HistoryRollback() {
  const [terminalAuth, setTerminalAuth] = useState("wpdev:wpdev");
  const [runnerToken, setRunnerToken] = useState("");
  const [commit, setCommit] = useState("");
  const [hardConfirm, setHardConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState("");
  const [tokenBusy, setTokenBusy] = useState(false);
  const [tokenMessage, setTokenMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const run = async (action: Parameters<typeof runTerminalAction>[2], args?: Record<string, string>) => {
    if (!terminalAuth.trim() || !runnerToken.trim()) {
      setOutput("Set terminal auth and runner token first.");
      return;
    }
    setBusy(true);
    setOutput("Starting command...\n");
    try {
      const started = await runTerminalAction(terminalAuth.trim(), runnerToken.trim(), action, args);
      if (!started.ok) {
        setOutput(`Runner error: ${started.error}`);
        return;
      }
      for (let i = 0; i < 300; i += 1) {
        const st = await getTerminalJobStatus(terminalAuth.trim(), runnerToken.trim(), started.jobId);
        if (!st.ok) {
          setOutput(`Status error: ${st.error}`);
          return;
        }
        setOutput(st.output || "Running...");
        if (st.status === "done") return;
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-slate-900 dark:text-white">History & Rollback</h2>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Browse git history and roll back to known-good commit points.
      </p>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Terminal auth (user:password)</span>
          <input
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            value={terminalAuth}
            onChange={(e) => setTerminalAuth(e.target.value)}
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Runner token</span>
          <input
            type="password"
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            value={runnerToken}
            onChange={(e) => setRunnerToken(e.target.value)}
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            setRunnerToken(generateRunnerToken());
            setTokenMessage({ tone: "success", text: "Generated a new runner token in the input field." });
          }}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800"
        >
          Generate token
        </button>
        <button
          type="button"
          disabled={tokenBusy || !runnerToken.trim()}
          onClick={async () => {
            setTokenBusy(true);
            setTokenMessage(null);
            try {
              const saved = await saveDockerEnvSecrets(
                { WPDEV_TERMINAL_RUNNER_TOKEN: runnerToken.trim() },
                runnerToken.trim() || undefined,
              );
              if (!saved.ok) {
                setTokenMessage({ tone: "error", text: `Could not save runner token: ${saved.error}` });
                return;
              }
              setTokenMessage({ tone: "success", text: "Saved WPDEV_TERMINAL_RUNNER_TOKEN to docker/.env." });
            } finally {
              setTokenBusy(false);
            }
          }}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800"
        >
          {tokenBusy ? "Saving token..." : "Save to docker/.env"}
        </button>
      </div>
      {tokenMessage && (
        <div
          className={`rounded border px-3 py-2 text-xs ${
            tokenMessage.tone === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100"
              : "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100"
          }`}
        >
          {tokenMessage.text}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void run("git_status")}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800"
        >
          Git status
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run("git_log")}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800"
        >
          Recent commits
        </button>
      </div>

      <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <label className="block">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Commit hash</span>
          <input
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            value={commit}
            onChange={(e) => setCommit(e.target.value)}
            placeholder="e.g. dee1fb5"
          />
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || !commit.trim()}
            onClick={() => void run("git_show", { commit: commit.trim() })}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800"
          >
            Show commit diff
          </button>
          <button
            type="button"
            disabled={busy || !commit.trim()}
            onClick={() => void run("git_rollback_branch", { commit: commit.trim() })}
            className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs text-white"
          >
            Safe rollback branch
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-red-300 p-3 dark:border-red-700">
        <p className="text-xs font-semibold text-red-700 dark:text-red-300">Danger zone: hard reset</p>
        <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
          This discards local changes. Type HARD_RESET_CONFIRM to enable.
        </p>
        <input
          className="mt-2 w-full rounded-lg border border-red-300 bg-white px-3 py-2 text-sm dark:border-red-700 dark:bg-slate-900"
          value={hardConfirm}
          onChange={(e) => setHardConfirm(e.target.value)}
          placeholder="HARD_RESET_CONFIRM"
        />
        <button
          type="button"
          disabled={busy || !commit.trim() || hardConfirm !== "HARD_RESET_CONFIRM"}
          onClick={() => void run("git_reset_hard", { commit: commit.trim(), confirm: hardConfirm })}
          className="mt-2 rounded-lg bg-red-600 px-3 py-1.5 text-xs text-white disabled:opacity-50"
        >
          Hard reset to commit
        </button>
      </div>

      <pre className="max-h-96 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] dark:border-slate-700 dark:bg-slate-950">
        {output || "No output yet."}
      </pre>
    </div>
  );
}

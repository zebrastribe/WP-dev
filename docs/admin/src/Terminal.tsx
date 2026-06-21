import { useState } from "react";
import { getTerminalJobStatus, runTerminalAction } from "./api";
import { useRunnerSecrets } from "./useRunnerSecrets";
import { TerminalEmbed } from "./TerminalEmbed";

type EnvName = "local" | "staging" | "production";

export function TerminalTab() {
  const { terminalAuth, terminalPort, runnerReady, runnerMessage, canRun } = useRunnerSecrets();
  const [env, setEnv] = useState<EnvName>("staging");
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState("");

  const run = async (
    action:
      | "generate_keypair"
      | "wpdev_doctor"
      | "wpdev_push"
      | "wpdev_pull"
      | "wpdev_sync_preview"
      | "backup_create"
      | "backup_list"
      | "git_status"
      | "git_log"
      | "ssh_test",
    args?: Record<string, string>,
    runnerKind: "terminal" | "sync" = "terminal",
  ) => {
    if (!canRun) {
      setOutput("Runner is not ready yet.");
      return;
    }
    setBusy(true);
    setOutput("Starting command...\n");
    try {
      const started = await runTerminalAction(action, args, runnerKind);
      if (!started.ok) {
        setOutput(`Runner error: ${started.error}`);
        return;
      }
      for (let i = 0; i < 300; i += 1) {
        const st = await getTerminalJobStatus(started.jobId, runnerKind);
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
      <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Terminal</h2>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Use the action buttons below; command output always appears in the lower output window.
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
        subtitle="Hidden by default. Open only when you need manual commands; quick actions run below either way."
      />

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
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !canRun}
          onClick={() => void run("wpdev_sync_preview", { env: "staging", direction: "push" }, "sync")}
          className="rounded-lg border border-brand-300 bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-800 dark:border-brand-800 dark:bg-brand-950/40 dark:text-brand-200"
        >
          Preview push → staging
        </button>
        <button
          type="button"
          disabled={busy || !canRun}
          onClick={() => void run("wpdev_push", { env: "staging" }, "sync")}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800"
        >
          Push localhost to staging
        </button>
        <button
          type="button"
          disabled={busy || !canRun}
          onClick={() => void run("wpdev_push", { env: "production" }, "sync")}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800"
        >
          Push localhost to production
        </button>
        <button
          type="button"
          disabled={busy || !canRun}
          onClick={() => void run("wpdev_pull", { env: "production" }, "sync")}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800"
        >
          Pull production to localhost
        </button>
        <button
          type="button"
          disabled={busy || !canRun}
          onClick={() => void run("generate_keypair")}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800"
        >
          Generate SSH keypair
        </button>
        <button
          type="button"
          disabled={busy || !canRun || env === "local"}
          onClick={() => void run("wpdev_doctor", { env })}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800"
        >
          Run doctor {env === "local" ? "(pick staging/prod)" : env}
        </button>
        <button
          type="button"
          disabled={busy || !canRun}
          onClick={() => void run("backup_create", { env, kind: "full" })}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800"
        >
          Create {env} full backup
        </button>
        <button
          type="button"
          disabled={busy || !canRun}
          onClick={() => void run("backup_list", { env, kind: "full" })}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800"
        >
          List {env} full backups
        </button>
      </div>

      <pre className="max-h-80 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] dark:border-slate-700 dark:bg-slate-950">
        {output || "No command output yet."}
      </pre>
    </div>
  );
}

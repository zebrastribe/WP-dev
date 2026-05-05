import { useEffect, useMemo, useState } from "react";
import { getTerminalJobStatus, loadTerminalRunnerSecrets, runTerminalAction } from "./api";

type EnvName = "local" | "staging" | "production";

export function TerminalTab() {
  const [terminalAuth, setTerminalAuth] = useState("");
  const [runnerToken, setRunnerToken] = useState("");
  const [terminalPort, setTerminalPort] = useState(7681);
  const [runnerReady, setRunnerReady] = useState(false);
  const [runnerMessage, setRunnerMessage] = useState("");
  const [env, setEnv] = useState<EnvName>("staging");
  const [showTerminal, setShowTerminal] = useState(true);
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState("");
  const [preparedCommand, setPreparedCommand] = useState("");

  const canRun = useMemo(
    () => Boolean(runnerReady && terminalAuth.trim() && runnerToken.trim()),
    [runnerReady, terminalAuth, runnerToken],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await loadTerminalRunnerSecrets();
      if (cancelled) return;
      if (!res.ok) {
        const startupHint =
          res.error === "not_found"
            ? "This admin API is outdated. Run: npm run admin:build:wp && npm run wp-dev -- down && npm run wp-dev -- up (in the same clone)."
            : "Run: npm run wp-dev -- up";
        setRunnerReady(false);
        setRunnerMessage(
          `Runner credentials are not initialized yet (${res.error}${res.detail ? `: ${res.detail}` : ""}). ${startupHint}`,
        );
        return;
      }
      setTerminalAuth(res.terminalAuth);
      setRunnerToken(res.runnerToken);
      setTerminalPort(res.terminalPort);
      setRunnerReady(true);
      setRunnerMessage("Runner security is loaded automatically from backend.");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const terminalUrl = useMemo(() => {
    const auth = terminalAuth.trim() || "wpdev:wpdev";
    const base = new URL(`${window.location.protocol}//127.0.0.1:${terminalPort}/`);
    const [user, pass] = auth.split(":", 2);
    if (user && pass) {
      base.username = user;
      base.password = pass;
    }
    return base.toString();
  }, [terminalAuth, terminalPort]);

  const run = async (
    action:
      | "generate_keypair"
      | "wpdev_doctor"
      | "backup_create"
      | "backup_list"
      | "git_status"
      | "git_log"
      | "ssh_test",
    args?: Record<string, string>,
  ) => {
    if (!canRun) {
      setOutput("Runner is not ready yet.");
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

  const prepareCommand = async (cmd: string) => {
    setPreparedCommand(cmd);
    try {
      await navigator.clipboard.writeText(cmd);
      setOutput(`Prepared command (copied):\n${cmd}\n\nPaste in terminal and press Enter.`);
    } catch {
      setOutput(`Prepared command:\n${cmd}\n\nCopy manually, paste in terminal, then press Enter.`);
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Terminal</h2>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Execute wp-dev commands in the browser terminal. Use quick actions below or paste your own command.
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

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Browser terminal</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Type directly here. If this panel is blank, click "Open in new tab" and use the same quick-run buttons below.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowTerminal((v) => !v)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs dark:border-slate-700"
            >
              {showTerminal ? "Hide terminal" : "Show terminal"}
            </button>
            <a
              href={terminalUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs dark:border-slate-700"
            >
              Open in new tab
            </a>
          </div>
        </div>
        {showTerminal ? (
          <iframe
            title="wp-dev terminal"
            src={terminalUrl}
            className="h-[420px] w-full rounded-lg border border-slate-200 dark:border-slate-700"
          />
        ) : null}
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
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void prepareCommand("npm run wp-dev -- push staging")}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800"
        >
          Push localhost to staging
        </button>
        <button
          type="button"
          onClick={() => void prepareCommand("npm run wp-dev -- push production")}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800"
        >
          Push localhost to production
        </button>
        <button
          type="button"
          onClick={() => void prepareCommand("npm run wp-dev -- pull production")}
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

      <div className="rounded-lg border border-slate-200 p-3 text-xs dark:border-slate-700">
        <p className="font-semibold text-slate-800 dark:text-slate-100">Prepared command</p>
        <input
          readOnly
          value={preparedCommand}
          placeholder="Click a sync button above to prepare a command..."
          className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
        />
        <p className="mt-2 text-slate-500 dark:text-slate-400">
          Security mode: sync commands are prepared only. You run them manually in terminal.
        </p>
      </div>

      <pre className="max-h-80 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] dark:border-slate-700 dark:bg-slate-950">
        {output || "No command output yet."}
      </pre>
    </div>
  );
}

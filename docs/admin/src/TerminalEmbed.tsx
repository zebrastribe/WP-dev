import { buildTerminalEmbedUrl } from "./api";

type TerminalEmbedProps = {
  terminalPort: number;
  terminalAuth: string;
  secretsReady: boolean;
  secretsError?: string;
  title?: string;
  subtitle?: string;
};

export function TerminalEmbed({
  terminalPort,
  terminalAuth,
  secretsReady,
  secretsError,
  title = "Browser terminal (optional)",
  subtitle = "SSH tests above use the runner — open this only if you need a full shell.",
}: TerminalEmbedProps) {
  const colon = terminalAuth.indexOf(":");
  const terminalUser = colon > 0 ? terminalAuth.slice(0, colon) : "";
  const canOpen = secretsReady && colon > 0;

  const openTerminal = () => {
    const url = buildTerminalEmbedUrl(terminalPort, terminalAuth);
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
        </div>
        <button
          type="button"
          disabled={!canOpen}
          onClick={openTerminal}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700"
        >
          Open terminal in new tab
        </button>
      </div>

      {!secretsReady && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          {secretsError ||
            "Terminal service not ready. Run npm run wp-dev -- up on the host, then refresh this page."}
        </p>
      )}

      {canOpen ? (
        <p className="mt-3 text-xs text-slate-600 dark:text-slate-300">
          Opens <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">127.0.0.1:{terminalPort}</code>{" "}
          in a new tab. Login user: <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">{terminalUser}</code>
          {" "}— password is in <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">docker/.env</code>{" "}
          (<code className="rounded bg-slate-100 px-1 dark:bg-slate-800">WPDEV_TERMINAL_AUTH</code>).
        </p>
      ) : null}
    </div>
  );
}

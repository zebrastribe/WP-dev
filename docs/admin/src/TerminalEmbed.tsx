import { buildTerminalEmbedUrl, terminalIframeBlockedByHttpsAdmin } from "./api";

type TerminalEmbedProps = {
  terminalPort: number;
  terminalAuth: string;
  secretsReady: boolean;
  secretsError?: string;
  showTerminal: boolean;
  onToggleShow: () => void;
  iframeClassName?: string;
  title?: string;
  subtitle?: string;
};

export function TerminalEmbed({
  terminalPort,
  terminalAuth,
  secretsReady,
  secretsError,
  showTerminal,
  onToggleShow,
  iframeClassName = "h-[360px]",
  title = "Browser terminal",
  subtitle = "Use this for SSH tests and wp-dev commands in this step.",
}: TerminalEmbedProps) {
  const embedUrl = buildTerminalEmbedUrl(terminalPort, terminalAuth);
  const httpsBlocked = terminalIframeBlockedByHttpsAdmin();
  const canEmbed = secretsReady && terminalAuth.includes(":") && !httpsBlocked;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onToggleShow}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs dark:border-slate-700"
          >
            {showTerminal ? "Hide terminal" : "Show terminal"}
          </button>
          <a
            href={embedUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs dark:border-slate-700"
          >
            Open in new tab
          </a>
        </div>
      </div>

      {!secretsReady && (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          {secretsError ||
            "Terminal service not ready. Run npm run wp-dev -- up on the host, then refresh this page."}
        </p>
      )}

      {httpsBlocked && (
        <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          HTTPS admin cannot embed the terminal (mixed content). Use{" "}
          <strong>Open in new tab</strong> or open{" "}
          <code className="rounded bg-amber-100 px-1 dark:bg-amber-900/60">{embedUrl.replace(/:[^:@/]+@/, ":***@")}</code>
          .
        </p>
      )}

      {showTerminal && canEmbed ? (
        <iframe
          title="wp-dev terminal"
          src={embedUrl}
          className={`${iframeClassName} w-full rounded-lg border border-slate-200 dark:border-slate-700`}
        />
      ) : showTerminal && secretsReady && !httpsBlocked && !terminalAuth.includes(":") ? (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-6 text-center text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
          Loading terminal credentials…
        </p>
      ) : null}
    </div>
  );
}

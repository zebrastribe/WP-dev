import { useCallback, useState } from "react";
import { getTerminalJobStatus, runTerminalAction } from "./api";
import { useRunnerSecrets } from "./useRunnerSecrets";

type Row = {
  target: "core" | "plugin" | "theme";
  slug: string;
  label: string;
  version: string;
  available: string;
};

type Report = {
  possible: boolean;
  reason?: string;
  core: { current: string; available: string | null };
  plugins: { slug: string; label: string; version: string; available: string }[];
  themes: { slug: string; label: string; version: string; available: string }[];
};

function parseReport(output: string): Report | null {
  const start = output.indexOf('{"possible"');
  if (start < 0) return null;
  try {
    return JSON.parse(output.slice(start)) as Report;
  } catch {
    return null;
  }
}

async function waitForJob(jobId: string): Promise<{ output: string; exitCode: number | null }> {
  for (let i = 0; i < 120; i += 1) {
    const st = await getTerminalJobStatus(jobId, "sync");
    if (!st.ok) return { output: st.error ?? "The runner did not answer.", exitCode: 1 };
    if (st.status === "done") return { output: st.output ?? "", exitCode: st.exitCode };
    await new Promise((r) => window.setTimeout(r, 500));
  }
  return { output: "The check is still running.", exitCode: 1 };
}

export function LocalSiteUpdate() {
  const { runnerReady, runnerMessage, canRun } = useRunnerSecrets("Host runner not ready");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [core, setCore] = useState("");

  const check = useCallback(async () => {
    if (!canRun) {
      setMessage(runnerMessage || "Runner is not ready yet.");
      return;
    }
    setBusy(true);
    setMessage("Checking this site…");
    const started = await runTerminalAction("wpdev_site_check", {}, "sync");
    if (!started.ok) {
      setBusy(false);
      setMessage(started.error ?? "Check did not start.");
      return;
    }
    const finished = await waitForJob(started.jobId);
    const output = finished.output;
    const report = parseReport(output);
    setBusy(false);
    if (!report) {
      setMessage(output.trim() || "Update check did not return a report.");
      return;
    }
    if (!report.possible) {
      setRows([]);
      setMessage(report.reason || "This site cannot be checked yet.");
      return;
    }
    const next: Row[] = [];
    if (report.core.available) {
      next.push({
        target: "core",
        slug: "wordpress",
        label: "WordPress",
        version: report.core.current,
        available: report.core.available,
      });
    }
    for (const item of report.plugins) {
      next.push({ target: "plugin", slug: item.slug, label: item.label || item.slug, version: item.version, available: item.available });
    }
    for (const item of report.themes) {
      next.push({ target: "theme", slug: item.slug, label: item.label || item.slug, version: item.version, available: item.available });
    }
    setCore(report.core.current);
    setRows(next);
    setPicked({});
    setMessage(next.length === 0 ? `WordPress ${report.core.current}. Nothing to update.` : `WordPress ${report.core.current}. ${next.length} update${next.length === 1 ? "" : "s"} found.`);
  }, [canRun, runnerMessage]);

  const applySelected = useCallback(async () => {
    const chosen = rows.filter((row) => picked[`${row.target}:${row.slug}`]);
    if (chosen.length === 0) {
      setMessage("Select at least one update.");
      return;
    }
    setBusy(true);
    const failed: Row[] = [];
    const done = new Set<string>();
    for (const row of chosen) {
      setMessage(`Updating ${row.label}…`);
      const started = await runTerminalAction(
        "wpdev_site_apply",
        row.target === "core" ? { target: "core" } : { target: row.target, slug: row.slug },
        "sync",
      );
      if (!started.ok) {
        failed.push(row);
        setMessage(started.error ?? `${row.label} did not start.`);
        continue;
      }
      const finished = await waitForJob(started.jobId);
      if (finished.exitCode !== 0) {
        failed.push(row);
        setMessage(finished.output.trim() || `${row.label} did not finish.`);
      } else {
        done.add(`${row.target}:${row.slug}`);
      }
    }
    setRows((current) => current.filter((row) => !done.has(`${row.target}:${row.slug}`)));
    setPicked({});
    setBusy(false);
    if (failed.length === 0) setMessage("Selected updates finished. The finished rows were removed.");
  }, [picked, rows]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Update</h1>
        <p className="mt-1 text-sm text-slate-600">
          WordPress, plugins, and themes on this Local site.
        </p>
      </div>
      {!runnerReady ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{runnerMessage}</p>
      ) : null}
      <button
        type="button"
        disabled={busy}
        onClick={() => void check()}
        className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        Check this site
      </button>
      {message ? <p className="text-sm text-slate-700">{message}</p> : null}
      {rows.length > 0 ? (
        <div className="space-y-2">
          {rows.map((row) => {
            const key = `${row.target}:${row.slug}`;
            return (
              <label key={key} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={Boolean(picked[key])}
                  onChange={(e) => setPicked((cur) => ({ ...cur, [key]: e.target.checked }))}
                />
                <span className="font-medium">{row.label}</span>
                <span className="text-slate-500">
                  {row.version} → {row.available}
                </span>
              </label>
            );
          })}
          <button
            type="button"
            disabled={busy}
            onClick={() => void applySelected()}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            Update selected
          </button>
        </div>
      ) : null}
    </div>
  );
}

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
      <RepositoryDeploy busy={busy} setBusy={setBusy} canRun={canRun} />
    </div>
  );
}

type RepoBranch = { name: string; sha: string };

function readableRunnerOutput(output: string): string {
  const line = output
    .split("\n")
    .map((row) => row.trim())
    .find((row) => row.startsWith("Error:"));
  if (line) return line.replace(/^Error:\s*/, "");
  return output.trim().slice(-800);
}

function parseBranchList(output: string): { branches: RepoBranch[]; truncated: boolean } | null {
  const start = output.indexOf('{"provider"');
  if (start < 0) return null;
  try {
    const parsed = JSON.parse(output.slice(start)) as { branches?: RepoBranch[]; truncated?: boolean };
    const branches = Array.isArray(parsed.branches) ? parsed.branches.filter((row) => row && typeof row.name === "string" && row.name) : [];
    return { branches, truncated: Boolean(parsed.truncated) };
  } catch {
    return null;
  }
}

function RepositoryDeploy({
  busy,
  setBusy,
  canRun,
}: {
  busy: boolean;
  setBusy: (value: boolean) => void;
  canRun: boolean;
}) {
  const [env, setEnv] = useState<"staging" | "production">("staging");
  const [target, setTarget] = useState<"plugin" | "theme" | "core">("plugin");
  const [slug, setSlug] = useState("");
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [directory, setDirectory] = useState("");
  const [branches, setBranches] = useState<RepoBranch[]>([]);
  const [branch, setBranch] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [promote, setPromote] = useState(false);
  const [note, setNote] = useState("");

  const loadBranches = async () => {
    if (!canRun) return;
    if (!url.trim()) {
      setNote("Enter the repository address.");
      return;
    }
    setBusy(true);
    setNote("Loading branches…");
    setBranches([]);
    setBranch("");
    const started = await runTerminalAction("wpdev_repo_branches", { url: url.trim(), token }, "sync");
    if (!started.ok) {
      setBusy(false);
      setNote(started.error ?? "Could not load branches.");
      return;
    }
    const done = await waitForJob(started.jobId);
    setBusy(false);
    const list = parseBranchList(done.output);
    if (!list || done.exitCode !== 0) {
      setNote(readableRunnerOutput(done.output) || "Could not load branches.");
      return;
    }
    setBranches(list.branches);
    setTruncated(list.truncated);
    setBranch(list.branches[0]?.name ?? "");
    setNote(list.branches.length === 0 ? "This repository has no branches." : `${list.branches.length} branches.`);
  };

  const run = async (apply: boolean) => {
    if (!canRun) return;
    if (!url.trim() || !branch) {
      setNote("Load the branches, then choose one.");
      return;
    }
    if (target !== "core" && !slug.trim()) {
      setNote("Enter the plugin or theme slug.");
      return;
    }
    if (apply && env === "production") {
      const typed = window.prompt('Type "production" to deploy this repository to Production.') ?? "";
      if (typed.trim().toLowerCase() !== "production") return;
    }
    setBusy(true);
    setNote(apply ? "Deploying…" : "Reviewing the commit…");
    const started = await runTerminalAction(
      "wpdev_deploy",
      {
        env,
        target,
        slug,
        url: url.trim(),
        branch,
        directory: directory.trim(),
        token,
        promote: promote ? "1" : "0",
        dry_run: apply ? "0" : "1",
        yes: apply ? "1" : "0",
      },
      "sync",
    );
    if (!started.ok) {
      setBusy(false);
      setNote(started.error ?? "Deploy did not start.");
      return;
    }
    const done = await waitForJob(started.jobId);
    setBusy(false);
    setNote(readableRunnerOutput(done.output) || (done.exitCode === 0 ? "Done." : "Deploy failed."));
  };

  const field = "mt-1 w-full min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm";

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 p-4">
      <h2 className="text-lg font-semibold text-slate-900">Repository</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-sm text-slate-700 sm:col-span-2">
          Repository address
          <input value={url} onChange={(e) => { setUrl(e.target.value); setBranches([]); setBranch(""); }} className={field} placeholder="https://github.com/account/repository" autoComplete="off" />
          <span className="mt-1 block text-slate-500">GitHub, Bitbucket, or a Bitbucket server on this network. An IP address or a local name both work.</span>
        </label>
        <label className="block text-sm text-slate-700 sm:col-span-2">
          Access token
          <input value={token} onChange={(e) => setToken(e.target.value)} type="password" className={field} autoComplete="off" placeholder="Only for a private repository" />
        </label>
        <div className="sm:col-span-2">
          <button type="button" disabled={busy} onClick={() => void loadBranches()} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-50">
            Load branches
          </button>
        </div>
        <label className="block text-sm text-slate-700">
          Branch
          <select value={branch} onChange={(e) => setBranch(e.target.value)} disabled={branches.length === 0} className={field} aria-label="Branch">
            {branches.length === 0 ? <option value="">Load branches first</option> : null}
            {branches.map((row) => (
              <option key={row.name} value={row.name}>
                {row.name} ({row.sha})
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm text-slate-700">
          Send to
          <select value={env} onChange={(e) => setEnv(e.target.value as "staging" | "production")} className={field} aria-label="Send to">
            <option value="staging">Staging</option>
            <option value="production">Production</option>
          </select>
        </label>
        <label className="block text-sm text-slate-700">
          Component
          <select value={target} onChange={(e) => setTarget(e.target.value as "plugin" | "theme" | "core")} className={field} aria-label="Component">
            <option value="plugin">Plugin</option>
            <option value="theme">Theme</option>
            <option value="core">WordPress</option>
          </select>
        </label>
        {target !== "core" ? (
          <label className="block text-sm text-slate-700">
            Slug
            <input value={slug} onChange={(e) => setSlug(e.target.value)} className={field} aria-label="Slug" />
          </label>
        ) : (
          <span className="hidden sm:block" />
        )}
        <label className="block text-sm text-slate-700 sm:col-span-2">
          Folder inside the repository
          <input value={directory} onChange={(e) => setDirectory(e.target.value)} className={field} placeholder="Leave empty for the repository root" aria-label="Folder inside the repository" />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
          <input type="checkbox" checked={promote} onChange={(e) => setPromote(e.target.checked)} />
          Promote the Staging commit
        </label>
        {truncated ? <p className="text-sm text-slate-500 sm:col-span-2">The repository has more branches than this list.</p> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => void run(false)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-50">
          Review commit
        </button>
        <button type="button" disabled={busy} onClick={() => void run(true)} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
          Deploy repository
        </button>
      </div>
      {note ? <p className="break-words text-sm text-slate-700">{note}</p> : null}
    </section>
  );
}

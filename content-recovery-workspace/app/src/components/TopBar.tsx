import type { ProjectStats } from "../types";

type Props = {
  project: string;
  stats?: ProjectStats;
  search: string;
  onSearchChange: (v: string) => void;
  onValidate: () => void;
  onExport: () => void;
  onIngest: () => void;
  busy: boolean;
  clientMode?: boolean;
};

function approvedCount(stats?: ProjectStats): string {
  if (!stats?.counts) return "—";
  let approved = 0;
  let total = 0;
  for (const type of Object.values(stats.counts)) {
    total += type.total;
    approved += type.by_status.approved ?? 0;
    approved += type.by_status.exported ?? 0;
  }
  return `${approved}/${total} approved`;
}

export function TopBar({
  project,
  stats,
  search,
  onSearchChange,
  onValidate,
  onExport,
  onIngest,
  busy,
  clientMode = false,
}: Props) {
  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
      <div>
        <div className="text-xs uppercase tracking-wide text-slate-500">Project</div>
        <div className="font-semibold text-slate-900 dark:text-white">{project}</div>
      </div>
      <div className="flex-1 min-w-[200px]">
        <input
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search content…"
          className="w-full max-w-md rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
        />
      </div>
      <div className="text-sm text-slate-600 dark:text-slate-300">Approved: {approvedCount(stats)}</div>
      {!clientMode ? (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={onIngest}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800"
          >
            Ingest KB
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onValidate}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800"
          >
            Validate
          </button>
        </>
      ) : null}
      <button
        type="button"
        disabled={busy}
        onClick={onExport}
        className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {clientMode ? "Export for WordPress" : "Export"}
      </button>
    </header>
  );
}

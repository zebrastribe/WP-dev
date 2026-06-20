import type { ContentListItem, ProjectStats } from "../types";

const SECTIONS = [
  { id: "page", label: "Pages" },
  { id: "post", label: "Posts" },
  { id: "job", label: "Jobs" },
  { id: "service", label: "Services" },
  { id: "header", label: "Header" },
  { id: "footer", label: "Footer" },
] as const;

type Props = {
  activeType: string;
  onTypeChange: (type: string) => void;
  objects: ContentListItem[];
  selectedId?: string;
  onSelect: (id: string) => void;
  stats?: ProjectStats;
};

function statusColor(status: string): string {
  switch (status) {
    case "approved":
    case "exported":
      return "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200";
    case "needs_review":
      return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200";
    case "excluded":
      return "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300";
    default:
      return "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200";
  }
}

export function Sidebar({ activeType, onTypeChange, objects, selectedId, onSelect, stats }: Props) {
  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/50">
      <nav className="border-b border-slate-200 p-2 dark:border-slate-800">
        {SECTIONS.map((section) => {
          const count = stats?.counts[section.id]?.total ?? 0;
          const active = activeType === section.id;
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => onTypeChange(section.id)}
              className={`mb-1 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${
                active
                  ? "bg-white font-semibold text-brand-700 shadow-sm dark:bg-slate-800 dark:text-brand-400"
                  : "text-slate-700 hover:bg-white/70 dark:text-slate-300 dark:hover:bg-slate-800/70"
              }`}
            >
              <span>{section.label}</span>
              <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs dark:bg-slate-700">{count}</span>
            </button>
          );
        })}
      </nav>
      <div className="flex-1 overflow-y-auto p-2">
        {objects.length === 0 ? (
          <p className="p-3 text-sm text-slate-500">No objects. Run Ingest KB.</p>
        ) : (
          objects.map((obj) => (
            <button
              key={obj.id}
              type="button"
              onClick={() => onSelect(obj.id)}
              className={`mb-1 w-full rounded-lg px-3 py-2 text-left ${
                selectedId === obj.id
                  ? "bg-white shadow-sm ring-1 ring-brand-500 dark:bg-slate-800"
                  : "hover:bg-white/80 dark:hover:bg-slate-800/60"
              }`}
            >
              <div className="truncate text-sm font-medium text-slate-900 dark:text-white">
                {obj.title || obj.slug}
              </div>
              <div className="mt-1 flex items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${statusColor(obj.status)}`}>
                  {obj.status.replace(/_/g, " ")}
                </span>
                <span className="text-xs text-slate-500">{obj.compatibility_score}%</span>
              </div>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}

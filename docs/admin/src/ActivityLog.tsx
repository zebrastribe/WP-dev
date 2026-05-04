import { useEffect, useRef, useState } from "react";
import { clearAdminLog, getAdminLogSnapshot, subscribeAdminLog, type AdminLogEntry } from "./adminLog";

export function ActivityLog() {
  const [rows, setRows] = useState<AdminLogEntry[]>(() => getAdminLogSnapshot());
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return subscribeAdminLog(() => setRows(getAdminLogSnapshot()));
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [rows.length]);

  const copyAll = async () => {
    const text = rows.map((r) => `[${r.ts}] [${r.level}] ${r.message}${r.detail ? ` | ${r.detail}` : ""}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* */
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/80">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-800">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
          Activity log
        </h3>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={copyAll}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
          >
            Copy
          </button>
          <button
            type="button"
            onClick={() => {
              clearAdminLog();
            }}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
          >
            Clear
          </button>
        </div>
      </div>
      <div className="max-h-48 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed">
        {rows.length === 0 ? (
          <p className="text-slate-500">No events yet — wizard and API calls will appear here.</p>
        ) : (
          rows.map((r, i) => (
            <div
              key={`${r.ts}-${i}`}
              className={
                r.level === "error"
                  ? "text-red-700 dark:text-red-300"
                  : r.level === "warn"
                    ? "text-amber-800 dark:text-amber-200"
                    : "text-slate-700 dark:text-slate-300"
              }
            >
              <span className="text-slate-400 dark:text-slate-500">{r.ts.slice(11, 19)}</span>{" "}
              <span className="font-semibold">[{r.level}]</span> {r.message}
              {r.detail && <span className="text-slate-500"> — {r.detail}</span>}
            </div>
          ))
        )}
        <div ref={bottom} />
      </div>
      <p className="border-t border-slate-200 px-3 py-1.5 text-[10px] text-slate-500 dark:border-slate-800">
        Server-side: <code className="rounded bg-slate-200 px-0.5 dark:bg-slate-800">logs/wp-dev-admin-api.log</code>{" "}
        (repo root, next to CLI log).
      </p>
    </div>
  );
}

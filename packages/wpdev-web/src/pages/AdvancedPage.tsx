import { useMemo, useState } from "react";
import {
  ActivityLog,
  ConfigAssistant,
  HistoryRollback,
  NAV_ITEMS,
  PhpVersionsPanel,
  ServicesTab,
  TerminalTab,
  UpdateTab,
  type NavId,
} from "@wpdev/web-host";

type AdvId =
  | "history"
  | "config"
  | "php"
  | "services"
  | "terminal"
  | "update"
  | "docs";

const ADV_NAV: { id: AdvId; label: string; machineOnly?: boolean }[] = [
  { id: "history", label: "Restore points" },
  { id: "config", label: "Copy config JSON" },
  { id: "php", label: "PHP versions" },
  { id: "services", label: "Services / ports" },
  { id: "terminal", label: "Terminal", machineOnly: true },
  { id: "update", label: "Update wp-dev", machineOnly: true },
  { id: "docs", label: "Documentation" },
];

/**
 * Advanced (plan C.3/C.4) — power tools, not primary nav.
 */
export function AdvancedPage() {
  const [id, setId] = useState<AdvId>("history");
  const [docId, setDocId] = useState<NavId>("overview");
  const doc = useMemo(
    () => NAV_ITEMS.find((n) => n.id === docId) ?? NAV_ITEMS[0]!,
    [docId],
  );
  const DocComponent = doc.Component;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          Advanced
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Power tools. Everyday work is on Backup, Setup staging, and Sync.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {ADV_NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setId(item.id)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              id === item.id
                ? "bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900"
                : "border border-slate-300 dark:border-slate-600"
            }`}
          >
            {item.label}
            {item.machineOnly ? (
              <span className="ml-1 text-[10px] font-normal opacity-70">this machine</span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900/60">
        {id === "history" && <HistoryRollback />}
        {id === "config" && <ConfigAssistant />}
        {id === "php" && <PhpVersionsPanel />}
        {id === "services" && <ServicesTab />}
        {id === "terminal" && (
          <div className="space-y-2">
            <p className="text-xs text-amber-800 dark:text-amber-200">
              Terminal is available on this machine only — not in the hosted UI.
            </p>
            <TerminalTab />
          </div>
        )}
        {id === "update" && <UpdateTab />}
        {id === "docs" && (
          <div className="flex flex-col gap-4 lg:flex-row">
            <nav className="flex w-full shrink-0 flex-col gap-0.5 lg:w-48">
              {NAV_ITEMS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setDocId(item.id)}
                  className={`rounded-lg px-3 py-2 text-left text-sm ${
                    docId === item.id
                      ? "bg-brand-600 text-white"
                      : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </nav>
            <div className="min-w-0 flex-1">
              <h2 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">
                {doc.label}
              </h2>
              <DocComponent />
            </div>
          </div>
        )}
      </div>

      <details className="rounded-xl border border-slate-200 dark:border-slate-800">
        <summary className="cursor-pointer px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Activity log
        </summary>
        <div className="border-t border-slate-200 p-2 dark:border-slate-800">
          <ActivityLog />
        </div>
      </details>
    </div>
  );
}

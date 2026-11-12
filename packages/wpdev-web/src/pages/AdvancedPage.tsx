import { useMemo, useState } from "react";
import {
  ActivityLog,
  ConfigAssistant,
  HistoryRollback,
  NAV_ITEMS,
  PhpVersionsPanel,
  ServicesTab,
  SyncTab,
  TerminalTab,
  UpdateTab,
  Wizard,
  type NavId,
} from "@wpdev/web-host";
import { SyncPage } from "./SyncPage";

type AdvId =
  | "files"
  | "theme"
  | "rules"
  | "history"
  | "config"
  | "php"
  | "services"
  | "terminal"
  | "update"
  | "docs";

const ADV_GROUPS: { title: string; items: { id: AdvId; label: string }[] }[] = [
  {
    title: "Copying",
    items: [
      { id: "rules", label: "Full site rules" },
      { id: "theme", label: "Theme files" },
    ],
  },
  {
    title: "This computer",
    items: [
      { id: "files", label: "Project files" },
      { id: "php", label: "PHP" },
      { id: "services", label: "Services" },
      { id: "terminal", label: "Terminal" },
      { id: "update", label: "Update wp-dev" },
    ],
  },
  {
    title: "Recovery",
    items: [
      { id: "history", label: "Restore points" },
      { id: "config", label: "Config file" },
      { id: "docs", label: "Docs" },
    ],
  },
];

const ADV_BLURB: Record<AdvId, string> = {
  rules: "What a full site pull or push copies. Theme files ignores this list.",
  theme: "Copy theme CSS and JS without replacing the database.",
  files: "Paths, terminal login, and DNS for this project.",
  php: "PHP for the WordPress on this computer.",
  services: "Ports and Docker services for this project.",
  terminal: "Shows this computer's SSH public key. Doctor and backups run in the project runner.",
  update: "Update the wp-dev tool on this computer.",
  history: "Older copies you can restore on this computer.",
  config: "Read or copy this project’s config.",
  docs: "Short notes for this tool.",
};

/**
 * Advanced (plan C.3/C.4) — power tools, not primary nav.
 */
export function AdvancedPage() {
  const [id, setId] = useState<AdvId>("rules");
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
          Extra controls. Setup, Sync, Backup, and Update stay the everyday tabs.
        </p>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
      <nav className="flex shrink-0 flex-col gap-4 lg:w-52" aria-label="Advanced">
        {ADV_GROUPS.map((group) => (
          <div key={group.title}>
            <p className="px-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {group.title}
            </p>
            <div className="mt-1 flex flex-col gap-0.5">
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setId(item.id)}
                  className={`rounded-lg px-3 py-2 text-left text-sm ${
                    id === item.id
                      ? "bg-slate-800 font-medium text-white dark:bg-slate-200 dark:text-slate-900"
                      : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900/60">
        <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">{ADV_BLURB[id]}</p>
        {id === "files" && <Wizard surface="tools" />}
        {id === "theme" && <SyncPage mode="theme" />}
        {id === "rules" && <SyncTab rulesOnly />}
        {id === "history" && <HistoryRollback />}
        {id === "config" && <ConfigAssistant />}
        {id === "php" && <PhpVersionsPanel />}
        {id === "services" && <ServicesTab />}
        {id === "terminal" && <TerminalTab />}
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

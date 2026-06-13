import { useEffect, useMemo, useState } from "react";
import { ActivityLog } from "./ActivityLog";
import { logAdmin } from "./adminLog";
import { BackupRestore } from "./BackupRestore";
import { HistoryRollback } from "./HistoryRollback";
import { TerminalTab } from "./Terminal";
import { Wizard } from "./Wizard";
import { NAV_ITEMS, type NavId } from "./guideSections";

const NOTES_PREFIX = "wpdev-admin-notes-";

type MainTab = "wizard" | "terminal" | "backup" | "history" | "docs";

function useDarkMode() {
  const [dark, setDark] = useState(() => {
    if (typeof localStorage === "undefined") return true;
    const saved = localStorage.getItem("wp-dev-admin-theme");
    if (saved === null) return true;
    return saved !== "light";
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("wp-dev-admin-theme", dark ? "dark" : "light");
  }, [dark]);
  return [dark, setDark] as const;
}

export default function App() {
  const [mainTab, setMainTab] = useState<MainTab>("wizard");
  const [activeId, setActiveId] = useState<NavId>("overview");
  const [dark, setDark] = useDarkMode();
  const [notes, setNotes] = useState("");

  useEffect(() => {
    logAdmin("info", "App: loaded", window.location.href);
  }, []);

  useEffect(() => {
    logAdmin("info", "App: main tab changed", mainTab);
  }, [mainTab]);

  const active = useMemo(
    () => NAV_ITEMS.find((n) => n.id === activeId) ?? NAV_ITEMS[0]!,
    [activeId],
  );

  useEffect(() => {
    const saved = localStorage.getItem(NOTES_PREFIX + activeId) ?? "";
    setNotes(saved);
  }, [activeId]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      localStorage.setItem(NOTES_PREFIX + activeId, notes);
    }, 300);
    return () => window.clearTimeout(t);
  }, [notes, activeId]);

  const { Component } = active;

  return (
    <div className="flex min-h-screen flex-col">
      <div className="border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => {
                setMainTab("wizard");
              }}
              className={`rounded-md px-4 py-2 text-sm font-semibold ${
                mainTab === "wizard"
                  ? "bg-white text-brand-700 shadow dark:bg-slate-900 dark:text-brand-400"
                  : "text-slate-600 dark:text-slate-400"
              }`}
            >
              wp-dev
            </button>
            <button
              type="button"
              onClick={() => {
                setMainTab("terminal");
              }}
              className={`rounded-md px-4 py-2 text-sm font-semibold ${
                mainTab === "terminal"
                  ? "bg-white text-brand-700 shadow dark:bg-slate-900 dark:text-brand-400"
                  : "text-slate-600 dark:text-slate-400"
              }`}
            >
              Terminal
            </button>
            <button
              type="button"
              onClick={() => {
                setMainTab("backup");
              }}
              className={`rounded-md px-4 py-2 text-sm font-semibold ${
                mainTab === "backup"
                  ? "bg-white text-brand-700 shadow dark:bg-slate-900 dark:text-brand-400"
                  : "text-slate-600 dark:text-slate-400"
              }`}
            >
              Backup/Restore
            </button>
            <button
              type="button"
              onClick={() => {
                setMainTab("history");
              }}
              className={`rounded-md px-4 py-2 text-sm font-semibold ${
                mainTab === "history"
                  ? "bg-white text-brand-700 shadow dark:bg-slate-900 dark:text-brand-400"
                  : "text-slate-600 dark:text-slate-400"
              }`}
            >
              Restore Points
            </button>
            <button
              type="button"
              onClick={() => {
                setMainTab("docs");
              }}
              className={`rounded-md px-4 py-2 text-sm font-semibold ${
                mainTab === "docs"
                  ? "bg-white text-brand-700 shadow dark:bg-slate-900 dark:text-brand-400"
                  : "text-slate-600 dark:text-slate-400"
              }`}
            >
              Documentation
            </button>
          </div>
        </div>
      </div>

      {mainTab === "wizard" ? (
        <div className="flex flex-1 justify-center bg-slate-50 p-6 dark:bg-slate-950">
          <div className="w-full max-w-4xl rounded-xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-slate-900 dark:text-white">wp-dev</h1>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                  Configure host SSH + URLs, save to <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">wp-dev.config.json</code>, then pull or install WordPress locally.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDark(!dark)}
                className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-sm dark:border-slate-600"
              >
                {dark ? "Light" : "Dark"}
              </button>
            </div>
            <Wizard />
            <div className="mt-8">
              <ActivityLog />
            </div>
          </div>
        </div>
      ) : mainTab === "terminal" ? (
        <div className="flex flex-1 justify-center bg-slate-50 p-6 dark:bg-slate-950">
          <div className="w-full max-w-4xl rounded-xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
            <TerminalTab />
            <div className="mt-8">
              <ActivityLog />
            </div>
          </div>
        </div>
      ) : mainTab === "backup" ? (
        <div className="flex flex-1 justify-center bg-slate-50 p-6 dark:bg-slate-950">
          <div className="w-full max-w-4xl rounded-xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
            <BackupRestore />
            <div className="mt-8">
              <ActivityLog />
            </div>
          </div>
        </div>
      ) : mainTab === "history" ? (
        <div className="flex flex-1 justify-center bg-slate-50 p-6 dark:bg-slate-950">
          <div className="w-full max-w-4xl rounded-xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
            <HistoryRollback />
            <div className="mt-8">
              <ActivityLog />
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-1">
          <aside className="flex w-64 shrink-0 flex-col border-r border-slate-800 bg-slate-900 text-slate-200">
            <div className="border-b border-slate-800 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Documentation</p>
              <h1 className="text-lg font-bold text-white">wp-dev</h1>
            </div>
            <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
              {NAV_ITEMS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    logAdmin("info", "App: documentation section", item.id);
                    setActiveId(item.id);
                  }}
                  className={`flex w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
                    activeId === item.id
                      ? "bg-brand-600 text-white"
                      : "text-slate-300 hover:bg-slate-800 hover:text-white"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </nav>
            <div className="border-t border-slate-800 p-3 text-[10px] leading-snug text-slate-500">
              Layout inspired by{" "}
              <a
                href="https://tailadmin.com/"
                className="text-brand-400 underline"
                target="_blank"
                rel="noreferrer"
              >
                TailAdmin
              </a>
              .
            </div>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-xl font-semibold text-slate-900 dark:text-white">{active.label}</h2>
              <button
                type="button"
                onClick={() => setDark(!dark)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm dark:border-slate-700"
              >
                {dark ? "Light mode" : "Dark mode"}
              </button>
            </header>

            <main className="flex-1 space-y-6 overflow-y-auto p-6">
              <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
                <Component />
              </div>

              <ActivityLog />

              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
                <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">
                  Your notes (saved in this browser)
                </h3>
                <textarea
                  className="min-h-[120px] w-full rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  placeholder="Reminders, SSH hostnames, ticket IDs…"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </main>
          </div>
        </div>
      )}
    </div>
  );
}

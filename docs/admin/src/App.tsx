import { useEffect, useMemo, useState } from "react";
import { ActivityLog } from "./ActivityLog";
import { logAdmin } from "./adminLog";
import { Wizard } from "./Wizard";
import { NAV_ITEMS, type NavId } from "./guideSections";

const NOTES_PREFIX = "wpdev-admin-notes-";

type MainTab = "wizard" | "docs";

function useDarkMode() {
  const [dark, setDark] = useState(() => {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem("wp-dev-admin-theme") === "dark";
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
  const [showTerminal, setShowTerminal] = useState(true);

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
  const terminalUrl = `${window.location.protocol}//${window.location.hostname}:7681/`;

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
              Setup wizard
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
          <p className="text-xs text-slate-500 dark:text-slate-400">
            First-time? Use the wizard, then open your local WordPress URL (not this /admin path for WP itself).
          </p>
        </div>
      </div>

      {mainTab === "wizard" ? (
        <div className="flex flex-1 justify-center bg-slate-50 p-6 dark:bg-slate-950">
          <div className="w-full max-w-4xl rounded-xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Environment wizard</h1>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                  Configure host SSH + URLs, save to <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">wp-dev.config.json</code>, then use the CLI (<code className="rounded bg-slate-100 px-1 dark:bg-slate-800">wp-dev pull</code> / <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">up</code>).
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
            <div className="mt-8 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Browser terminal</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Use this for SSH tests and wp-dev commands directly from the wizard.
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setShowTerminal((v) => !v)}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs dark:border-slate-700"
                  >
                    {showTerminal ? "Hide terminal" : "Show terminal"}
                  </button>
                  <a
                    href={terminalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs dark:border-slate-700"
                  >
                    Open in new tab
                  </a>
                </div>
              </div>
              {showTerminal ? (
                <iframe
                  title="wp-dev terminal"
                  src={terminalUrl}
                  className="h-[460px] w-full rounded-lg border border-slate-200 dark:border-slate-700"
                />
              ) : null}
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

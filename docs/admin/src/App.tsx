import { useEffect, useState } from "react";
import {
  AdvancedPage,
  BackupPage,
  PRIMARY_TABS,
  SetupStagingPage,
  SyncPage,
  type PrimaryTab,
} from "@wpdev/web";
import { AdminAuthBar } from "./AdminAuthBar";
import { ActivityLog } from "./ActivityLog";
import { logAdmin } from "./adminLog";

/** Thin Vite shell: auth and LocalAdapter host wiring via `@wpdev/web-host`. */
export default function App() {
  const [tab, setTab] = useState<PrimaryTab>("setup");

  useEffect(() => {
    document.documentElement.classList.remove("dark");
  }, []);

  useEffect(() => {
    logAdmin("info", "App: loaded (plan IA)", window.location.href);
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="mx-auto flex max-w-5xl flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-bold tracking-tight text-slate-900">wp-dev</p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setTab("advanced")}
                className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${
                  tab === "advanced"
                    ? "border-brand-600 bg-brand-50 text-brand-700"
                    : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}
              >
                Advanced
              </button>
              <AdminAuthBar />
            </div>
          </div>

          <nav className="grid grid-cols-3 gap-2" aria-label="Primary">
            {PRIMARY_TABS.map((item) => {
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`rounded-xl border px-3 py-3 text-left transition ${
                    active
                      ? "border-brand-600 bg-brand-50 shadow-sm"
                      : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white"
                  }`}
                >
                  <span
                    className={`block text-sm font-semibold ${
                      active ? "text-brand-700" : "text-slate-800"
                    }`}
                  >
                    {item.label}
                  </span>
                  <span className="mt-0.5 block text-xs text-slate-500">{item.hint}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="flex flex-1 justify-center p-4 sm:p-6">
        <div className="w-full max-w-5xl">
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            {tab === "backup" && <BackupPage />}
            {tab === "setup" && <SetupStagingPage />}
            {tab === "sync" && <SyncPage />}
            {tab === "advanced" && <AdvancedPage />}
            {tab !== "advanced" && (
              <details className="mt-8 rounded-xl border border-slate-200">
                <summary className="cursor-pointer px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Activity log
                </summary>
                <div className="border-t border-slate-200 p-2">
                  <ActivityLog />
                </div>
              </details>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

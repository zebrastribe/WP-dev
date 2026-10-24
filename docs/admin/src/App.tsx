import { useEffect, useState } from "react";
import {
  AdvancedPage,
  BackupPage,
  EnvBadges,
  PRIMARY_TABS,
  SetupStagingPage,
  SyncPage,
  type PrimaryTab,
} from "@wpdev/web";
import { AdminAuthBar } from "./AdminAuthBar";
import { ActivityLog } from "./ActivityLog";
import { logAdmin } from "./adminLog";

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

/** Thin Vite shell: auth, theme, and LocalAdapter host wiring via `@wpdev/web-host`. */
export default function App() {
  const [tab, setTab] = useState<PrimaryTab>("sync");
  const [dark, setDark] = useDarkMode();

  useEffect(() => {
    logAdmin("info", "App: loaded (plan IA)", window.location.href);
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-5xl flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm font-bold tracking-tight text-slate-900 dark:text-white">
                wp-dev
              </p>
              <nav
                className="flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800"
                aria-label="Primary"
              >
                {PRIMARY_TABS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setTab(item.id)}
                    className={`rounded-md px-3 py-2 text-sm font-semibold ${
                      tab === item.id
                        ? "bg-white text-brand-700 shadow dark:bg-slate-900 dark:text-brand-400"
                        : "text-slate-600 dark:text-slate-400"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </nav>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setDark(!dark)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm dark:border-slate-600"
              >
                {dark ? "Light" : "Dark"}
              </button>
              <AdminAuthBar />
            </div>
          </div>
          <EnvBadges />
        </div>
      </header>

      <main className="flex flex-1 justify-center bg-slate-50 p-6 dark:bg-slate-950">
        <div className="w-full max-w-5xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/80 sm:p-8">
          {tab === "backup" && <BackupPage />}
          {tab === "setup" && <SetupStagingPage />}
          {tab === "sync" && <SyncPage />}
          {tab === "advanced" && <AdvancedPage />}
          {tab !== "advanced" && (
            <details className="mt-8 rounded-xl border border-slate-200 dark:border-slate-800">
              <summary className="cursor-pointer px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Activity log
              </summary>
              <div className="border-t border-slate-200 p-2 dark:border-slate-800">
                <ActivityLog />
              </div>
            </details>
          )}
        </div>
      </main>
    </div>
  );
}

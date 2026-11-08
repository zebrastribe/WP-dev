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
import { loadProjectFolder } from "./api";
import { LocalSiteUpdate } from "./LocalSiteUpdate";
import { logAdmin } from "./adminLog";

/** Thin Vite shell: auth and LocalAdapter host wiring via `@wpdev/web-host`. */
export default function App() {
  const [tab, setTab] = useState<PrimaryTab>("setup");
  const [projectFolder, setProjectFolder] = useState("");

  useEffect(() => {
    document.documentElement.classList.remove("dark");
  }, []);

  useEffect(() => {
    logAdmin("info", "App: loaded (plan IA)", window.location.href);
  }, []);

  useEffect(() => {
    void loadProjectFolder().then((folder) => {
      if (folder) setProjectFolder(folder);
    });
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="mx-auto flex max-w-5xl flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold tracking-tight text-slate-900">WP-dev Local</p>
              {projectFolder ? (
                <p className="text-xs text-slate-500">{projectFolder}</p>
              ) : null}
            </div>
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

          <nav className="flex justify-center" aria-label="Primary">
            <div className="inline-flex flex-wrap justify-center gap-1 rounded-full bg-slate-100 p-1">
              {PRIMARY_TABS.map((item) => {
                const active = tab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setTab(item.id)}
                    className={`rounded-full px-4 py-1.5 text-sm font-semibold ${
                      active ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </nav>
        </div>
      </header>

      <main className="flex flex-1 justify-center p-4 sm:p-6">
        <div className="w-full max-w-5xl">
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            {tab === "backup" && <BackupPage />}
            {tab === "setup" && <SetupStagingPage />}
            {tab === "sync" && <SyncPage />}
            {tab === "update" && <LocalSiteUpdate />}
            {tab === "advanced" && <AdvancedPage />}
          </div>
        </div>
      </main>
    </div>
  );
}

import { useEffect, useState } from "react";
import { loadLocalStatus, loadWpDevConfig, useAdminAuth } from "@wpdev/web-host";
import { ENV_LABEL, type EnvRole } from "./adapter/types";

type Badge = { role: EnvRole; detail: string; ok: boolean | null };

export function EnvBadges() {
  const { authenticated, authVersion } = useAdminAuth();
  const [locked, setLocked] = useState(!authenticated);
  const [badges, setBadges] = useState<Badge[]>([
    { role: "dev", detail: "…", ok: null },
    { role: "staging", detail: "…", ok: null },
    { role: "production", detail: "…", ok: null },
  ]);

  useEffect(() => {
    let cancelled = false;
    if (!authenticated) {
      setLocked(true);
      return () => {
        cancelled = true;
      };
    }
    void (async () => {
      const [status, cfg] = await Promise.all([loadLocalStatus(), loadWpDevConfig()]);
      if (cancelled) return;
      if (!status.ok && !cfg) {
        setLocked(true);
        return;
      }
      setLocked(false);
      const stagingHost =
        cfg && typeof (cfg.staging as { host?: string } | undefined)?.host === "string"
          ? String((cfg.staging as { host: string }).host)
          : "";
      const prodHost =
        cfg && typeof (cfg.production as { host?: string } | undefined)?.host === "string"
          ? String((cfg.production as { host: string }).host)
          : "";
      const isPlaceholderHost = (host: string) =>
        !host ||
        host.includes("example.com") ||
        host.includes("example.invalid") ||
        host.endsWith(".invalid");
      // Staging/Production green would mean "safe to push" — only show host-saved (neutral) vs not set.
      const stagingSaved = Boolean(stagingHost && !isPlaceholderHost(stagingHost));
      const prodSaved = Boolean(prodHost && !isPlaceholderHost(prodHost));
      setBadges([
        {
          role: "dev",
          detail: status.ok
            ? status.wpInstalled
              ? "online"
              : "stack / install"
            : "offline",
          ok: status.ok ? status.wpInstalled : false,
        },
        {
          role: "staging",
          detail: stagingSaved ? `host saved · ${stagingHost}` : "not set",
          ok: stagingSaved ? null : false,
        },
        {
          role: "production",
          detail: prodSaved ? `host saved · ${prodHost}` : "not set",
          ok: prodSaved ? null : false,
        },
      ]);
    })();
    return () => {
      cancelled = true;
    };
  }, [authenticated, authVersion]);

  if (locked || !authenticated) {
    return (
      <div className="flex flex-wrap gap-2" aria-label="Environments">
        <span className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
          Unlock to see environments
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2" aria-label="Environments">
      {badges.map((b) => (
        <span
          key={b.role}
          className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
            b.ok === true
              ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100"
              : b.ok === false
                ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
                : "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
          }`}
          title={b.detail}
        >
          <span className="font-semibold">{ENV_LABEL[b.role]}</span>
          <span aria-hidden className="opacity-40">
            ·
          </span>
          <span className="max-w-[10rem] truncate opacity-80">{b.detail}</span>
        </span>
      ))}
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { logAdmin } from "./adminLog";
import { EXAMPLE_WP_DEV_CONFIG } from "./generated/exampleConfig";

const DEFAULT_JSON = JSON.stringify(EXAMPLE_WP_DEV_CONFIG, null, 2);

export function ConfigAssistant() {
  const [raw, setRaw] = useState(DEFAULT_JSON);
  const prevParseOk = useRef<boolean | null>(null);

  useEffect(() => {
    logAdmin("info", "ConfigAssistant: opened");
  }, []);

  const parsedResult = useMemo(() => {
    try {
      const value = JSON.parse(raw) as Record<string, unknown>;
      return { ok: true as const, value };
    } catch (e) {
      return {
        ok: false as const,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }, [raw]);

  const parsed = parsedResult.ok ? parsedResult.value : null;
  const parseError = parsedResult.ok ? null : parsedResult.error;

  useEffect(() => {
    const ok = parsedResult.ok;
    const prev = prevParseOk.current;
    if (prev === true && !ok && !parsedResult.ok) {
      logAdmin("warn", "ConfigAssistant: JSON became invalid", parsedResult.error);
    } else if (prev === false && ok) {
      logAdmin("info", "ConfigAssistant: JSON is valid again");
    }
    prevParseOk.current = ok;
  }, [parsedResult]);

  const setField = useCallback(
    (path: string[], value: string) => {
      try {
        const o = JSON.parse(raw) as Record<string, unknown>;
        let cur: Record<string, unknown> = o;
        for (let i = 0; i < path.length - 1; i++) {
          const k = path[i]!;
          const next = cur[k];
          if (next && typeof next === "object" && !Array.isArray(next)) {
            cur = next as Record<string, unknown>;
          } else return;
        }
        const last = path[path.length - 1]!;
        cur[last] = value;
        setRaw(JSON.stringify(o, null, 2));
      } catch (e) {
        logAdmin(
          "warn",
          "ConfigAssistant: form field could not sync to JSON",
          e instanceof Error ? e.message : String(e),
        );
      }
    },
    [raw],
  );

  const g = (path: string[]) => {
    if (!parsed) return "";
    let cur: unknown = parsed;
    for (const p of path) {
      if (cur && typeof cur === "object" && p in (cur as object)) {
        cur = (cur as Record<string, unknown>)[p];
      } else return "";
    }
    return cur === undefined || cur === null ? "" : String(cur);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(raw);
      logAdmin("info", "ConfigAssistant: copied JSON to clipboard", `chars=${raw.length}`);
    } catch (e) {
      logAdmin(
        "error",
        "ConfigAssistant: clipboard write failed",
        e instanceof Error ? e.message : String(e),
      );
    }
  };

  const field = (label: string, path: string[], hint: string) => (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
        {label}
      </span>
      <input
        type="text"
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        value={g(path)}
        onChange={(e) => setField(path, e.target.value)}
        disabled={!parsed}
      />
      <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>
    </label>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
          Form (edits JSON on the right)
        </h3>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Adjust common fields, then copy the JSON into{" "}
          <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">wp-dev.config.json</code> next
          to <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">package.json</code>. Secrets
          stay out of git (see repo <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">.gitignore</code>
          ).
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {field("project", ["project"], "Unique per clone; used for Docker Compose -p and backup paths.")}
          {field("local.url", ["local", "url"], "Browser URL for Docker WordPress, e.g. http://localhost:8888")}
        </div>
        <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Staging (remote)</h4>
        <div className="grid gap-3 sm:grid-cols-2">
          {field("staging.host", ["staging", "host"], "SSH hostname (often cluster name on shared hosting)")}
          {field("staging.user", ["staging", "user"], "SSH user")}
          {field("staging.path", ["staging", "path"], "Remote dir containing wp-config.php")}
          {field("staging.url", ["staging", "url"], "Must match siteurl/home on that server for search-replace")}
        </div>
        <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Production (remote)</h4>
        <div className="grid gap-3 sm:grid-cols-2">
          {field("production.host", ["production", "host"], "SSH hostname")}
          {field("production.user", ["production", "user"], "SSH user")}
          {field("production.path", ["production", "path"], "WordPress root on server")}
          {field("production.url", ["production", "url"], "Public URL for DB search-replace")}
        </div>
        <div>
          <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">
            simply.account (optional)
          </span>
          <input
            type="text"
            className="w-full max-w-xs rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-slate-700 dark:bg-slate-900"
            placeholder="S123456"
            value={
              parsed && typeof parsed.simply === "object" && parsed.simply
                ? String((parsed.simply as { account?: string }).account ?? "")
                : ""
            }
            onChange={(e) => {
              try {
                const o = JSON.parse(raw) as Record<string, unknown>;
                const v = e.target.value.trim();
                if (!v) delete o.simply;
                else o.simply = { account: v };
                setRaw(JSON.stringify(o, null, 2));
              } catch (e) {
                logAdmin(
                  "warn",
                  "ConfigAssistant: simply field could not sync (fix JSON first)",
                  e instanceof Error ? e.message : String(e),
                );
              }
            }}
            disabled={!parsed}
          />
          <p className="mt-1 text-xs text-slate-500">
            API key: environment variable <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">WPDEV_SIMPLY_API_KEY</code> — never paste keys here; use shell env.
          </p>
        </div>
      </div>
      <div className="flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">JSON</h3>
          <button
            type="button"
            onClick={copy}
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
          >
            Copy
          </button>
        </div>
        {parseError && (
          <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
            Invalid JSON: {parseError}
          </p>
        )}
        <textarea
          className="min-h-[28rem] flex-1 w-full resize-y rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          spellCheck={false}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
        />
        <p className="mt-2 text-xs text-slate-500">
          You can paste an existing <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">wp-dev.config.json</code>{" "}
          here to edit it, then copy back.
        </p>
      </div>
    </div>
  );
}

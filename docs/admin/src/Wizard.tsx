import { useCallback, useEffect, useState } from "react";
import {
  loadSimplyStatus,
  loadWpDevConfig,
  saveDockerEnvSecrets,
  saveWpDevConfig,
  verifySimplyApi,
} from "./api";
import { logAdmin } from "./adminLog";
import { EXAMPLE_WP_DEV_CONFIG } from "./generated/exampleConfig";

const STEP_LABELS = ["Welcome", "Production", "Staging", "Simply", "Save"] as const;

type WizardAlert = { tone: "info" | "success" | "error"; text: string };

const PULL_TERMINAL_HINT = [
  "The wizard cannot show pull progress — pull runs in your terminal, not in the browser.",
  "Run the copied command in the repo root (folder with package.json).",
  "Time: often a few minutes; large media or DB can take 30+ minutes.",
  "Done: the command exits and wp-dev logs command … finished ok (see logs/wp-dev.log on the host).",
  "Failed: the terminal prints an error — copy it; try wp-dev doctor production first if SSH or path is wrong.",
].join("\n");

/** Staging placeholder when user has no real staging server (from repo example config). */
const STAGING_PLACEHOLDER = {
  host: EXAMPLE_WP_DEV_CONFIG.staging.host,
  user: EXAMPLE_WP_DEV_CONFIG.staging.user,
  path: EXAMPLE_WP_DEV_CONFIG.staging.path,
  url: EXAMPLE_WP_DEV_CONFIG.staging.url,
} as const;

type Remote = {
  host: string;
  user: string;
  path: string;
  url: string;
};

export type WizardData = {
  project: string;
  local: {
    url: string;
    path: string;
    composeFile: string;
    composeService: string;
    wpRoot: string;
  };
  staging: Remote;
  production: Remote;
  simply?: { account: string };
};

function emptyRemote(): Remote {
  return { host: "", user: "", path: "", url: "" };
}

function defaults(): WizardData {
  const ex = EXAMPLE_WP_DEV_CONFIG;
  return {
    project: ex.project,
    local: {
      url: ex.local.url,
      path: ex.local.path,
      composeFile: ex.local.composeFile,
      composeService: ex.local.composeService,
      wpRoot: ex.local.wpRoot,
    },
    staging: { ...STAGING_PLACEHOLDER },
    production: emptyRemote(),
    simply: undefined,
  };
}

function toJson(data: WizardData): Record<string, unknown> {
  const o: Record<string, unknown> = {
    project: data.project.trim(),
    local: { ...data.local },
    staging: { ...data.staging },
    production: { ...data.production },
  };
  if (data.simply?.account?.trim()) {
    o.simply = { account: data.simply.account.trim().toUpperCase() };
  }
  return o;
}

const DRAFT_KEY = "wpdev-wizard-draft";

function alignLocalUrlToCurrentBrowser(url: string): { value: string; changed: boolean } {
  try {
    const saved = new URL(url);
    const browser = new URL(window.location.origin);
    const isLocal =
      saved.hostname === "localhost" ||
      saved.hostname === "127.0.0.1" ||
      saved.hostname === "::1";
    if (!isLocal) return { value: url, changed: false };
    if (saved.origin === browser.origin) return { value: url, changed: false };
    saved.protocol = browser.protocol;
    saved.hostname = browser.hostname;
    saved.port = browser.port;
    return { value: saved.toString().replace(/\/$/, ""), changed: true };
  } catch {
    return { value: url, changed: false };
  }
}

export function Wizard() {
  const [step, setStep] = useState(0);
  const [data, setData] = useState<WizardData>(defaults);
  const [hasStagingServer, setHasStagingServer] = useState(false);
  const [useSimply, setUseSimply] = useState(false);
  const [saveToken, setSaveToken] = useState("");
  /** Never stored in localStorage draft; optional write to host docker/.env after config save. */
  const [simplyApiKey, setSimplyApiKey] = useState("");
  const [simplyKeyPresent, setSimplyKeyPresent] = useState<boolean | null>(null);
  const [simplyTestBusy, setSimplyTestBusy] = useState(false);
  const [alert, setAlert] = useState<WizardAlert | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const goStep = useCallback((n: number) => {
    const i = Math.max(0, Math.min(4, n));
    logAdmin("info", `Wizard: step → ${i + 1} ${STEP_LABELS[i]}`);
    setStep(i);
  }, []);

  useEffect(() => {
    logAdmin("info", "Wizard: opened");
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      logAdmin("info", "Wizard: loading configuration from API or draft");
      try {
        const loaded = await loadWpDevConfig();
        if (cancelled) return;
        if (loaded && typeof loaded.project === "string") {
          const loadedLocalUrl = String((loaded.local as WizardData["local"])?.url ?? defaults().local.url);
          const aligned = alignLocalUrlToCurrentBrowser(loadedLocalUrl);
          if (aligned.changed) {
            logAdmin(
              "warn",
              "Wizard: local.url did not match current browser origin; adjusted in form",
              `from=${loadedLocalUrl} to=${aligned.value}`,
            );
          }
          setData({
            project: String(loaded.project),
            local: {
              url: aligned.value,
              path: String((loaded.local as WizardData["local"])?.path ?? "./docker"),
              composeFile: String(
                (loaded.local as WizardData["local"])?.composeFile ?? "docker-compose.yml",
              ),
              composeService: String(
                (loaded.local as WizardData["local"])?.composeService ?? "wpcli",
              ),
              wpRoot: String((loaded.local as WizardData["local"])?.wpRoot ?? "./wordpress"),
            },
            staging: {
              host: String((loaded.staging as Remote)?.host ?? STAGING_PLACEHOLDER.host),
              user: String((loaded.staging as Remote)?.user ?? "deploy"),
              path: String((loaded.staging as Remote)?.path ?? STAGING_PLACEHOLDER.path),
              url: String((loaded.staging as Remote)?.url ?? STAGING_PLACEHOLDER.url),
            },
            production: {
              host: String((loaded.production as Remote)?.host ?? ""),
              user: String((loaded.production as Remote)?.user ?? ""),
              path: String((loaded.production as Remote)?.path ?? ""),
              url: String((loaded.production as Remote)?.url ?? ""),
            },
            simply:
              loaded.simply &&
              typeof loaded.simply === "object" &&
              (loaded.simply as { account?: string }).account
                ? { account: String((loaded.simply as { account: string }).account) }
                : undefined,
          });
          setHasStagingServer(!String((loaded.staging as Remote)?.host ?? "").includes("example.invalid"));
          setUseSimply(Boolean(loaded.simply));
          setAlert({
            tone: "info",
            text: aligned.changed
              ? `Loaded wp-dev.config.json and adjusted local.url in the form to this browser (${aligned.value}). Click Save to persist this port change.`
              : `Loaded existing wp-dev.config.json (project “${String(loaded.project)}”). Edit any step and save to update.`,
          });
        } else {
          const raw = localStorage.getItem(DRAFT_KEY);
          if (raw) {
            try {
              const d = JSON.parse(raw) as WizardData;
              if (d && d.project) {
                setData(d);
                logAdmin("info", "Wizard: restored draft from localStorage", `project=${d.project}`);
                setAlert({
                  tone: "info",
                  text: "Restored an unsaved draft from this browser. Continue editing or save to write wp-dev.config.json.",
                });
              }
            } catch (e) {
              logAdmin("warn", "Wizard: draft in localStorage is invalid JSON", e instanceof Error ? e.message : "");
            }
          } else {
            logAdmin("info", "Wizard: no server config and no draft — using defaults");
            setAlert({
              tone: "info",
              text: "No wp-dev.config.json on the server yet (or not readable). Defaults are shown — complete the steps and save.",
            });
          }
        }
      } catch (e) {
        logAdmin("error", "Wizard: load failed unexpectedly", e instanceof Error ? e.message : String(e));
        setAlert({
          tone: "error",
          text: `Could not finish loading: ${e instanceof Error ? e.message : String(e)}`,
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
      } catch (e) {
        logAdmin("warn", "Wizard: could not write draft to localStorage", e instanceof Error ? e.message : String(e));
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [data]);

  const refreshSimplyStatus = useCallback(async () => {
    const r = await loadSimplyStatus();
    if (r.ok) {
      setSimplyKeyPresent(r.apiKeyPresent);
      return;
    }
    setSimplyKeyPresent(null);
  }, []);

  useEffect(() => {
    void refreshSimplyStatus();
  }, [refreshSimplyStatus]);

  const patch = useCallback(<K extends keyof WizardData>(key: K, val: WizardData[K]) => {
    setData((d) => ({ ...d, [key]: val }));
  }, []);

  const patchLocal = (key: keyof WizardData["local"], val: string) => {
    setData((d) => ({ ...d, local: { ...d.local, [key]: val } }));
  };

  const patchRemote = (env: "staging" | "production", key: keyof Remote, val: string) => {
    setData((d) => ({ ...d, [env]: { ...d[env], [key]: val } }));
  };

  const copyCommand = async (cmd: string, kind: "plain" | "pull" = "plain") => {
    try {
      await navigator.clipboard.writeText(cmd);
      logAdmin("info", "Wizard: copied command", cmd);
      if (kind === "pull") {
        logAdmin(
          "info",
          "Wizard: run copied pull in a terminal — browser has no live progress; watch terminal exit code and logs/wp-dev.log",
        );
        setAlert({
          tone: "info",
          text: `Copied:\n${cmd}\n\n${PULL_TERMINAL_HINT}`,
        });
      } else {
        setAlert({ tone: "info", text: `Copied command: ${cmd}` });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logAdmin("error", "Wizard: copy command failed", msg);
      setAlert({ tone: "error", text: `Could not copy command: ${msg}` });
    }
  };

  const onSave = async () => {
    setSaving(true);
    setAlert(null);
    logAdmin("info", "Wizard: save clicked", `project=${data.project.trim()}`);
    try {
      if (!data.production.host.trim() || !data.production.url.trim()) {
        logAdmin("warn", "Wizard: save blocked — missing production host or URL");
        setAlert({ tone: "error", text: "Production host and URL are required before saving." });
        return;
      }
      const staging = hasStagingServer
        ? data.staging
        : { ...STAGING_PLACEHOLDER, user: data.production.user || data.staging.user || "deploy" };
      const payload = toJson({ ...data, staging });
      if (!useSimply) delete payload.simply;
      const res = await saveWpDevConfig(payload, saveToken.trim() || undefined);
      if (!res.ok) {
        const err = "error" in res ? res.error : "unknown";
        setAlert({
          tone: "error",
          text:
            err.includes("write_config_failed")
              ? "Save failed: write_config_failed. The host file may not be writable by the container. Run: chmod u+rw wp-dev.config.json and then save again."
              : `Save failed: ${err}. Check Activity log and logs/wp-dev-admin-api.log. If forbidden, set the save token in docker/.env to match the wizard field.`,
        });
        return;
      }
      let extra = "";
      if (useSimply && data.simply?.account && simplyApiKey.trim()) {
        const keyRes = await saveDockerEnvSecrets(
          { WPDEV_SIMPLY_API_KEY: simplyApiKey.trim() },
          saveToken.trim() || undefined,
        );
        setSimplyApiKey("");
        if (!keyRes.ok) {
          extra = `\n\nSimply API key was NOT saved to docker/.env: ${"error" in keyRes ? keyRes.error : "unknown"}. Config JSON did save. Fix permissions/mount or save token, then save again with the key.`;
          logAdmin("warn", "Wizard: docker/.env secret save failed", "error" in keyRes ? keyRes.error : "");
        } else {
          extra =
            "\n\nSaved WPDEV_SIMPLY_API_KEY to docker/.env. Run `wp-dev down && wp-dev up` so the stack picks it up, then `wp-dev simply test`.";
          logAdmin("info", "Wizard: Simply API key written to docker/.env");
          await refreshSimplyStatus();
        }
      }
      localStorage.removeItem(DRAFT_KEY);
      logAdmin("info", "Wizard: draft cleared after successful save");
      setAlert({
        tone: "success",
        text:
          "Saved wp-dev.config.json. If you changed project or ports, run: wp-dev down && wp-dev up — then open your local WordPress URL." +
          extra,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logAdmin("error", "Wizard: save threw", msg);
      setAlert({ tone: "error", text: msg });
    } finally {
      setSaving(false);
    }
  };

  const input =
    "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100";

  if (loading) {
    return (
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Loading configuration… (see Activity log below if this hangs)
      </p>
    );
  }

  const alertBox =
    alert &&
    (() => {
      const cls =
        alert.tone === "success"
          ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100"
          : alert.tone === "error"
            ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100"
            : "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100";
      return (
        <div role="status" className={`whitespace-pre-line rounded-lg border px-4 py-3 text-sm ${cls}`}>
          {alert.text}
        </div>
      );
    })();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap gap-2 text-xs">
        {STEP_LABELS.map((label, i) => (
          <button
            key={label}
            type="button"
            onClick={() => goStep(i)}
            className={`rounded-full px-3 py-1 font-medium ${
              step === i
                ? "bg-brand-600 text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200"
            }`}
          >
            {i + 1}. {label}
          </button>
        ))}
      </div>

      {alertBox}

      {step === 0 && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Create or update your environment. This writes <strong>wp-dev.config.json</strong> in the project
            root (same folder as <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">package.json</code>
            ). Use port from <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">docker/.env</code> (
            <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">WP_PORT</code>) in your local URL.
          </p>
          <label className="block">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Project id</span>
            <input className={input} value={data.project} onChange={(e) => patch("project", e.target.value)} />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Local site URL</span>
            <input className={input} value={data.local.url} onChange={(e) => patchLocal("url", e.target.value)} />
          </label>
          <p className="text-xs text-slate-500">
            After save, open this URL in another tab to run the WordPress installer (or continue after a pull).
          </p>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Production is your live (or primary remote) WordPress. SSH details are often different from the public
            domain on shared hosting.
          </p>
          {(["host", "user", "path", "url"] as const).map((key) => (
            <label key={key} className="block capitalize">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-400">production.{key}</span>
              <input
                className={input}
                value={data.production[key]}
                onChange={(e) => patchRemote("production", key, e.target.value)}
              />
            </label>
          ))}
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={hasStagingServer}
              onChange={(e) => {
                const v = e.target.checked;
                logAdmin("info", `Wizard: staging server toggle → ${v ? "real" : "placeholder"}`);
                setHasStagingServer(v);
              }}
              className="rounded border-slate-300"
            />
            I have a real staging server (SSH + DNS)
          </label>
          {hasStagingServer ? (
            <div className="space-y-3">
              {(["host", "user", "path", "url"] as const).map((key) => (
                <label key={key} className="block capitalize">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-400">staging.{key}</span>
                  <input
                    className={input}
                    value={data.staging[key]}
                    onChange={(e) => patchRemote("staging", key, e.target.value)}
                  />
                </label>
              ))}
            </div>
          ) : (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/50 dark:text-amber-100">
              Staging will use RFC placeholder hosts (see README). Do not run{" "}
              <code className="rounded bg-amber-100 px-1 dark:bg-amber-900">pull staging</code> until you replace
              them.
            </p>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={useSimply}
              onChange={(e) => {
                const v = e.target.checked;
                logAdmin("info", `Wizard: Simply.com block → ${v ? "on" : "off"}`);
                setUseSimply(v);
                if (!v) setData((d) => ({ ...d, simply: undefined }));
              }}
              className="rounded border-slate-300"
            />
            Add Simply.com account + optional API key (saved to host <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">docker/.env</code> as{" "}
            <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">WPDEV_SIMPLY_API_KEY</code>, not in wp-dev.config.json)
          </label>
          {useSimply && (
            <div className="space-y-3">
              <label className="block">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">simply.account (S123456 or UE12345)</span>
                <input
                  className={input}
                  placeholder="S123456 or UE12345"
                  value={data.simply?.account ?? ""}
                  onChange={(e) =>
                    setData((d) => ({
                      ...d,
                      simply: e.target.value.trim() ? { account: e.target.value.trim().toUpperCase() } : undefined,
                    }))
                  }
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                  Simply.com API key (optional; saved to docker/.env on Save)
                </span>
                <input
                  className={input}
                  type="password"
                  autoComplete="off"
                  placeholder="Leave empty to keep existing key on server"
                  value={simplyApiKey}
                  onChange={(e) => setSimplyApiKey(e.target.value)}
                />
              </label>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-200">
                Server key status:{" "}
                {simplyKeyPresent === null ? "unknown" : simplyKeyPresent ? "present" : "missing"}.
                {" "}
                {simplyKeyPresent === false ? "Save API key below, then verify." : "You can verify API access now."}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={simplyTestBusy}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                  onClick={async () => {
                    setSimplyTestBusy(true);
                    try {
                      const r = await verifySimplyApi({
                        account: data.simply?.account?.trim() || undefined,
                        apiKey: simplyApiKey.trim() || undefined,
                      });
                      if (r.ok) {
                        setAlert({
                          tone: "success",
                          text: `Simply API verified (HTTP ${r.status}).`,
                        });
                        return;
                      }
                      const detail = r.detail ? `\n${r.detail}` : "";
                      setAlert({
                        tone: "error",
                        text: `Simply API verify failed: ${r.error}${detail}`,
                      });
                    } finally {
                      setSimplyTestBusy(false);
                    }
                  }}
                >
                  {simplyTestBusy ? "Verifying..." : "Verify Simply API now"}
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                  onClick={() => void refreshSimplyStatus()}
                >
                  Refresh key status
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            If you set <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">WPDEV_ADMIN_SAVE_TOKEN</code> in{" "}
            <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">docker/.env</code>, paste the same value
            here so the browser can send it on save.
          </p>
          <label className="block">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Optional save token</span>
            <input
              className={input}
              type="password"
              autoComplete="off"
              value={saveToken}
              onChange={(e) => setSaveToken(e.target.value)}
              placeholder="Leave empty if not configured"
            />
          </label>
          <pre className="max-h-64 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-700 dark:bg-slate-950">
            {JSON.stringify(
              toJson({
                ...data,
                staging: hasStagingServer
                  ? data.staging
                  : { ...STAGING_PLACEHOLDER, user: data.production.user || "deploy" },
                simply: useSimply ? data.simply : undefined,
              }),
              null,
              2,
            )}
          </pre>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save environment"}
            </button>
            <button
              type="button"
              onClick={() => goStep(0)}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm dark:border-slate-600"
            >
              Back to start
            </button>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-900/40">
            <p className="mb-2 font-medium text-slate-800 dark:text-slate-200">After save: pull in a terminal</p>
            <p className="mb-3 whitespace-pre-line text-xs text-slate-600 dark:text-slate-400">{PULL_TERMINAL_HINT}</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void copyCommand("npm run wp-dev -- pull production", "pull")}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
              >
                Copy: pull production
              </button>
              <button
                type="button"
                disabled={!hasStagingServer}
                onClick={() => void copyCommand("npm run wp-dev -- pull staging", "pull")}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
              >
                Copy: pull staging
              </button>
            </div>
          </div>
          <p className="text-xs text-slate-500">
            If save returns permission denied, the container user may not own <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">wp-dev.config.json</code> on the host — for local dev try{" "}
            <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">chmod u+w wp-dev.config.json</code> or run{" "}
            <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">wp-dev init</code> from the terminal instead.
          </p>
        </div>
      )}

      <div className="flex justify-between border-t border-slate-100 pt-4 dark:border-slate-800">
        <button
          type="button"
          disabled={step === 0}
          onClick={() => goStep(step - 1)}
          className="text-sm text-slate-600 hover:text-slate-900 disabled:opacity-40 dark:text-slate-400"
        >
          ← Previous
        </button>
        <button
          type="button"
          disabled={step === 4}
          onClick={() => goStep(step + 1)}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
        >
          {step === 4 ? "Finish" : "Next →"}
        </button>
      </div>
    </div>
  );
}

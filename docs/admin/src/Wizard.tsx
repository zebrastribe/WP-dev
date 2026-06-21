import { useCallback, useEffect, useState } from "react";
import {
  checkStagingDomain,
  checkStagingDbConnection,
  checkStagingHttps,
  getTerminalJobStatus,
  loadTerminalRunnerSecrets,
  loadStagingDbSecrets,
  loadSimplyStatus,
  loadLocalStatus,
  loadWpDevConfig,
  runTerminalAction,
  saveDockerEnvSecrets,
  saveWpDevConfig,
  type TerminalAction,
  type LocalStatus,
  verifySimplyApi,
  formatTerminalRunnerSecretsError,
} from "./api";
import { useAdminAuth } from "./AdminAuthProvider";
import { logAdmin } from "./adminLog";
import { EXAMPLE_WP_DEV_CONFIG } from "./generated/exampleConfig";
import { TerminalEmbed } from "./TerminalEmbed";

const STEP_LABELS = ["Start", "SSH server", "Staging (optional)", "Save & sync", "Done"] as const;
/** Wizard step index for staging — skipped when syncing from one remote only. */
const STAGING_STEP = 2;

type SetupWorkflow = "pull" | "local-only";

/** Best-effort site URL from SSH hostname (for DB search-replace after pull). */
function guessSiteUrlFromSshHost(host: string): string {
  const h = host.trim().toLowerCase().replace(/^ssh\./, "");
  if (!h || !h.includes(".")) return "";
  return `https://${h}`;
}

function isMacBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac/i.test(navigator.platform || navigator.userAgent);
}

function skipStagingWizardStep(workflow: SetupWorkflow, hasStagingServer: boolean): boolean {
  return workflow === "pull" && !hasStagingServer;
}

function wizardStepAfter(current: number, skipStaging: boolean): number {
  if (skipStaging && current === 1) return 3;
  return Math.min(STEP_LABELS.length - 1, current + 1);
}

function wizardStepBefore(current: number, skipStaging: boolean): number {
  if (skipStaging && current === 3) return 1;
  return Math.max(0, current - 1);
}

type WizardAlert = { tone: "info" | "success" | "error"; text: string };
type ChecklistStatus = "done" | "warn" | "todo";
type DomainCheckResult = {
  host: string;
  dnsOk: boolean;
  dnsRecords: string[];
  httpsOk: boolean;
  httpsStatus: number;
  redirectsToHttps: boolean;
  httpStatus: number;
  finalHostMatches: boolean;
  hints: string[];
  checkedAtIso: string;
} | null;
type TerminalPrepState = {
  command: string;
  copied: boolean;
  message: string;
} | null;
type TerminalRunState = {
  running: boolean;
  output: string;
} | null;

const PULL_TERMINAL_HINT = [
  "Run commands in a terminal (not in the browser).",
  "Use the repo root (folder with package.json).",
  "Pull/push can take time for large media or DB.",
  "If a command fails, copy the error and run: npm run wp-dev -- doctor <env>",
].join("\n");

const PUSH_TERMINAL_HINT = [
  "Push runs in your terminal, not in the browser.",
  "Run the copied command in the repo root (folder with package.json).",
  "wp-dev will sync local files/db to remote staging; this is destructive on staging data.",
  "Done: command exits and wp-dev logs command … finished ok.",
  "Failed: terminal prints the error; run wp-dev doctor staging first for SSH/path checks.",
].join("\n");

/** Staging placeholder when user has no real staging server (from repo example config). */
const STAGING_PLACEHOLDER = {
  host: EXAMPLE_WP_DEV_CONFIG.staging.host,
  user: EXAMPLE_WP_DEV_CONFIG.staging.user,
  path: EXAMPLE_WP_DEV_CONFIG.staging.path,
  url: EXAMPLE_WP_DEV_CONFIG.staging.url,
} as const;

/** Production placeholder for local-only workflow until user configures real production. */
const PRODUCTION_PLACEHOLDER = {
  host: "production.example.invalid",
  user: "deploy",
  path: "/var/www/production-not-used",
  url: "https://production.example.invalid",
} as const;

type Remote = {
  host: string;
  user: string;
  path: string;
  url: string;
  port?: number;
  identityFile?: string;
  db?: {
    host: string;
    name: string;
    user: string;
    password: string;
    prefix?: string;
  };
};

export type WizardData = {
  project: string;
  local: {
    url: string;
    path: string;
    composeFile: string;
    composeProjectName?: string;
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
  const normalizeRemote = (r: Remote): Remote => {
    // Keep DB secrets out of wp-dev.config.json; they are stored in local docker/.env.
    return {
      ...r,
      db: undefined,
    };
  };
  const o: Record<string, unknown> = {
    project: data.project.trim(),
    local: { ...data.local },
    staging: normalizeRemote(data.staging),
    production: normalizeRemote(data.production),
  };
  if (data.simply?.account?.trim()) {
    o.simply = { account: data.simply.account.trim().toUpperCase() };
  }
  return o;
}

const DRAFT_KEY = "wpdev-wizard-draft";

function checklistTone(status: ChecklistStatus): string {
  if (status === "done") return "text-emerald-700 dark:text-emerald-300";
  if (status === "warn") return "text-amber-700 dark:text-amber-300";
  return "text-slate-600 dark:text-slate-300";
}

function checklistBadge(status: ChecklistStatus): string {
  if (status === "done") return "OK";
  if (status === "warn") return "Check";
  return "TODO";
}

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
  const { authenticated, authVersion, requestUnlock } = useAdminAuth();
  const [step, setStep] = useState(0);
  const [data, setData] = useState<WizardData>(defaults);
  const [hasStagingServer, setHasStagingServer] = useState(false);
  const [useProviderIntegration, setUseProviderIntegration] = useState(false);
  const [terminalAuth, setTerminalAuth] = useState("");
  const [terminalWorkdir, setTerminalWorkdir] = useState("/workspace");
  const [terminalSettingsBusy, setTerminalSettingsBusy] = useState(false);
  const [terminalSettingsMessage, setTerminalSettingsMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  /** Never stored in localStorage draft; optional write to host docker/.env after config save. */
  const [providerApiKey, setProviderApiKey] = useState("");
  const [providerKeyPresent, setProviderKeyPresent] = useState<boolean | null>(null);
  const [providerApiTestBusy, setProviderApiTestBusy] = useState(false);
  const [providerKeySaveBusy, setProviderKeySaveBusy] = useState(false);
  const [providerKeySaveMessage, setProviderKeySaveMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [sslCheckBusy, setSslCheckBusy] = useState(false);
  const [domainCheckBusy, setDomainCheckBusy] = useState(false);
  const [domainCheckResult, setDomainCheckResult] = useState<DomainCheckResult>(null);
  const [readinessBusy, setReadinessBusy] = useState(false);
  const [dbCheckBusy, setDbCheckBusy] = useState(false);
  const [dbCheckMessage, setDbCheckMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [dbSaveBusy, setDbSaveBusy] = useState(false);
  const [dbSaveMessage, setDbSaveMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [alert, setAlert] = useState<WizardAlert | null>(null);
  const [loading, setLoading] = useState(true);
  const [localStatus, setLocalStatus] = useState<LocalStatus | null>(null);
  const [setupWorkflow, setSetupWorkflow] = useState<SetupWorkflow | null>(null);
  const [saving, setSaving] = useState(false);
  const [terminalPrep, setTerminalPrep] = useState<TerminalPrepState>(null);
  const [terminalRun, setTerminalRun] = useState<TerminalRunState>(null);
  const [showTerminal, setShowTerminal] = useState(true);
  const [terminalPort, setTerminalPort] = useState(7681);
  const [runnerToken, setRunnerToken] = useState("");
  const [terminalSecretsReady, setTerminalSecretsReady] = useState(false);
  const [terminalSecretsError, setTerminalSecretsError] = useState("");

  const goStep = useCallback((n: number) => {
    const i = Math.max(0, Math.min(STEP_LABELS.length - 1, n));
    logAdmin("info", `Wizard: step → ${i + 1} ${STEP_LABELS[i]}`);
    setStep(i);
  }, []);

  const goNext = useCallback(() => {
    setStep((s) => wizardStepAfter(s, skipStagingWizardStep(setupWorkflow ?? "pull", hasStagingServer)));
  }, [setupWorkflow, hasStagingServer]);

  const goPrev = useCallback(() => {
    setStep((s) => wizardStepBefore(s, skipStagingWizardStep(setupWorkflow ?? "pull", hasStagingServer)));
  }, [setupWorkflow, hasStagingServer]);

  useEffect(() => {
    logAdmin("info", "Wizard: opened");
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      logAdmin("info", "Wizard: loading configuration from API or draft");
      try {
        const [loaded, status] = await Promise.all([loadWpDevConfig(), loadLocalStatus()]);
        if (cancelled) return;
        if (status.ok) {
          setLocalStatus(status);
          if (status.needsSetup) {
            setSetupWorkflow(status.hasSyncedContent ? "local-only" : "pull");
          }
        }
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
              composeProjectName: String(
                (loaded.local as WizardData["local"])?.composeProjectName ?? "",
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
              port:
                typeof (loaded.staging as Remote)?.port === "number"
                  ? Number((loaded.staging as Remote)?.port)
                  : undefined,
              identityFile: String((loaded.staging as Remote)?.identityFile ?? ""),
              db: undefined,
            },
            production: {
              host: String((loaded.production as Remote)?.host ?? ""),
              user: String((loaded.production as Remote)?.user ?? ""),
              path: String((loaded.production as Remote)?.path ?? ""),
              url: String((loaded.production as Remote)?.url ?? ""),
              port:
                typeof (loaded.production as Remote)?.port === "number"
                  ? Number((loaded.production as Remote)?.port)
                  : undefined,
              identityFile: String((loaded.production as Remote)?.identityFile ?? ""),
              db: undefined,
            },
            simply:
              loaded.simply &&
              typeof loaded.simply === "object" &&
              (loaded.simply as { account?: string }).account
                ? { account: String((loaded.simply as { account: string }).account) }
                : undefined,
          });
          setHasStagingServer(!String((loaded.staging as Remote)?.host ?? "").includes("example.invalid"));
          setUseProviderIntegration(Boolean(loaded.simply));
          if (aligned.changed) {
            setAlert({
              tone: "info",
              text: `Adjusted local.url in the form to match this browser (${aligned.value}). Click Save to persist this port change.`,
            });
          } else {
            setAlert(null);
          }
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
    if (!authenticated) return;
    let cancelled = false;
    (async () => {
      const secrets = await loadStagingDbSecrets();
      if (cancelled || !secrets.ok) return;
      if (
        !secrets.host.trim() &&
        !secrets.name.trim() &&
        !secrets.user.trim() &&
        !secrets.password
      ) {
        return;
      }
      setData((d) => ({
        ...d,
        staging: {
          ...d.staging,
          db: {
            host: secrets.host,
            name: secrets.name,
            user: secrets.user,
            password: secrets.password,
            prefix: secrets.prefix,
          },
        },
      }));
    })();
    return () => {
      cancelled = true;
    };
  }, [authenticated, authVersion]);

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
      setProviderKeyPresent(r.apiKeyPresent);
      return;
    }
    setProviderKeyPresent(null);
  }, []);

  useEffect(() => {
    void refreshSimplyStatus();
  }, [refreshSimplyStatus]);

  useEffect(() => {
    if (!authenticated) {
      setTerminalSecretsReady(false);
      setTerminalSecretsError("Unlock admin to load runner credentials.");
      setRunnerToken("");
      return;
    }
    let cancelled = false;
    (async () => {
      const s = await loadTerminalRunnerSecrets();
      if (cancelled) return;
      if (!s.ok) {
        setTerminalSecretsReady(false);
        setTerminalSecretsError(formatTerminalRunnerSecretsError(s));
        setRunnerToken("");
        return;
      }
      setTerminalPort(s.terminalPort);
      setRunnerToken(s.runnerToken);
      setTerminalAuth(s.terminalAuth);
      setTerminalSecretsReady(true);
      setTerminalSecretsError("");
    })();
    return () => {
      cancelled = true;
    };
  }, [authenticated, authVersion]);

  const patch = useCallback(<K extends keyof WizardData>(key: K, val: WizardData[K]) => {
    setData((d) => ({ ...d, [key]: val }));
  }, []);

  const patchLocal = (key: keyof WizardData["local"], val: string) => {
    setData((d) => ({ ...d, local: { ...d.local, [key]: val } }));
  };

  const patchRemote = (
    env: "staging" | "production",
    key: "host" | "user" | "path" | "url" | "identityFile",
    val: string,
  ) => {
    setData((d) => ({ ...d, [env]: { ...d[env], [key]: val } }));
  };
  const patchRemotePort = (env: "staging" | "production", val: string) => {
    const n = Number.parseInt(val, 10);
    setData((d) => ({
      ...d,
      [env]: {
        ...d[env],
        port: Number.isFinite(n) && n > 0 ? n : undefined,
      },
    }));
  };
  const patchRemoteDb = (
    env: "staging" | "production",
    key: "host" | "name" | "user" | "password" | "prefix",
    val: string,
  ) => {
    setData((d) => ({
      ...d,
      [env]: {
        ...d[env],
        db: {
          host: d[env].db?.host ?? "",
          name: d[env].db?.name ?? "",
          user: d[env].db?.user ?? "",
          password: d[env].db?.password ?? "",
          prefix: d[env].db?.prefix ?? "",
          [key]: val,
        },
      },
    }));
  };

  const saveSimplyKeyNow = useCallback(async (): Promise<{ ok: true } | { ok: false; error: string }> => {
    const key = providerApiKey.trim();
    if (!key) return { ok: false, error: "Enter a Simply API key first." };
    const r = await saveDockerEnvSecrets({ WPDEV_SIMPLY_API_KEY: key });
    if (!r.ok) return { ok: false, error: "error" in r ? r.error : "unknown_error" };
    await refreshSimplyStatus();
    return { ok: true };
  }, [providerApiKey, refreshSimplyStatus]);

  const saveStagingDbSecretsNow = useCallback(async (): Promise<{ ok: true } | { ok: false; error: string }> => {
    const dbHost = data.staging.db?.host?.trim() || "";
    const dbName = data.staging.db?.name?.trim() || "";
    const dbUser = data.staging.db?.user?.trim() || "";
    const dbPass = data.staging.db?.password || "";
    if (!dbHost || !dbName || !dbUser || !dbPass) {
      return { ok: false, error: "Fill staging.db host/name/user/password first." };
    }
    const r = await saveDockerEnvSecrets({
        WPDEV_STAGING_DB_HOST: dbHost,
        WPDEV_STAGING_DB_NAME: dbName,
        WPDEV_STAGING_DB_USER: dbUser,
        WPDEV_STAGING_DB_PASSWORD: dbPass,
        ...(data.staging.db?.prefix?.trim()
          ? { WPDEV_STAGING_DB_PREFIX: data.staging.db.prefix.trim() }
          : {}),
      });
    if (!r.ok) return { ok: false, error: "error" in r ? r.error : "unknown_error" };
    return { ok: true };
  }, [data.staging.db]);

  const saveTerminalSettingsNow = useCallback(async (): Promise<{ ok: true } | { ok: false; error: string }> => {
    const auth = terminalAuth.trim();
    const workdir = terminalWorkdir.trim();
    const payload: Record<string, string> = {};
    if (auth) payload.WPDEV_TERMINAL_AUTH = auth;
    if (workdir) payload.WPDEV_TERMINAL_WORKDIR = workdir;
    if (!Object.keys(payload).length) {
      return { ok: false, error: "Set terminal auth and/or working directory first." };
    }
    const r = await saveDockerEnvSecrets(payload);
    if (!r.ok) return { ok: false, error: "error" in r ? r.error : "unknown_error" };
    return { ok: true };
  }, [terminalAuth, terminalWorkdir]);

  const runTerminalCommand = async (
    cmd: string,
    kind: "plain" | "pull" | "push" = "plain",
    action?: TerminalAction,
    args?: Record<string, string>,
  ) => {
    let copied = false;
    if (action) {
      setTerminalRun({ running: true, output: "Starting command...\n" });
      const started = await runTerminalAction(action, args);
      if (started.ok) {
        for (let i = 0; i < 240; i += 1) {
          const status = await getTerminalJobStatus(started.jobId);
          if (!status.ok) {
            setTerminalRun({
              running: false,
              output: `Runner status error: ${status.error}\n\nFalling back to manual command:\n${cmd}`,
            });
            break;
          }
          setTerminalRun({
            running: status.status === "running",
            output: status.output || "Running...",
          });
          if (status.status === "done") {
            setAlert({
              tone: status.exitCode === 0 ? "success" : "error",
              text:
                (status.exitCode === 0 ? "Command completed successfully." : `Command failed (exit ${status.exitCode ?? 1}).`) +
                "\n\nSee output in the command output panel below.",
            });
            return;
          }
          await new Promise((resolve) => window.setTimeout(resolve, 1000));
        }
      }
      // Runner unavailable/auth failed -> fallback to clipboard flow.
      if (!started.ok) {
        setTerminalRun({
          running: false,
          output: `Runner unavailable: ${started.error}\n\nFalling back to manual copy/run.`,
        });
      }
    }
    try {
      await navigator.clipboard.writeText(cmd);
      copied = true;
      logAdmin("info", "Wizard: prepared terminal command", cmd);
      const openHint =
        "Command copied. Use the embedded Browser terminal panel below, paste (Ctrl+Shift+V), and press Enter.";
      if (kind === "pull") {
        logAdmin(
          "info",
          "Wizard: run copied pull in a terminal — browser has no live progress; watch terminal exit code and logs/wp-dev.log",
        );
        setAlert({
          tone: "info",
          text: `${openHint}\n\nPrepared command:\n${cmd}\n\n${PULL_TERMINAL_HINT}`,
        });
      } else if (kind === "push") {
        logAdmin(
          "info",
          "Wizard: run copied push in a terminal — browser has no live progress; watch terminal exit code",
        );
        setAlert({
          tone: "info",
          text: `${openHint}\n\nPrepared command:\n${cmd}\n\n${PUSH_TERMINAL_HINT}`,
        });
      } else {
        setAlert({ tone: "info", text: `${openHint}\n\nPrepared command:\n${cmd}` });
      }
      setTerminalPrep({
        command: cmd,
        copied: true,
        message: "Prepared and copied. Paste into Browser terminal and press Enter.",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logAdmin("error", "Wizard: prepare terminal command failed", msg);
      setAlert({
        tone: "error",
        text: `Clipboard permission failed: ${msg}\n\nCommand is shown below. Copy it manually and run in Browser terminal.`,
      });
      setTerminalPrep({
        command: cmd,
        copied,
        message: "Clipboard failed. Copy command manually from the box below.",
      });
    }
  };

  const buildSshTestCommand = (env: "staging" | "production"): string => {
    const remote = data[env];
    const host = remote.host.trim() || "<ssh-host>";
    const user = remote.user.trim() || "<ssh-user>";
    return `ssh -o BatchMode=yes -o ConnectTimeout=10 -o UpdateHostKeys=no ${user}@${host} "pwd && ls -la && wp --info"`;
  };

  const buildKeypairCommand = (): string =>
    'test -f ~/.ssh/id_ed25519 || ssh-keygen -q -t ed25519 -N "" -f ~/.ssh/id_ed25519 -C "$USER@$(hostname)"; ls -la ~/.ssh/id_ed25519*; echo ""; echo "Public key:"; cat ~/.ssh/id_ed25519.pub';

  const onSave = async () => {
    setSaving(true);
    setAlert(null);
    logAdmin("info", "Wizard: save clicked", `project=${data.project.trim()}`);
    try {
      if (!authenticated) {
        requestUnlock();
        setAlert({
          tone: "error",
          text: "Unlock admin first (top right). Paste WPDEV_ADMIN_SAVE_TOKEN from docker/.env once per browser session.",
        });
        return;
      }
      const workflow = setupWorkflow ?? "pull";
      let production =
        workflow === "local-only" && !data.production.host.trim()
          ? { ...PRODUCTION_PLACEHOLDER, user: data.production.user.trim() || "deploy" }
          : { ...data.production };
      if (workflow === "pull") {
        if (!production.host.trim() || !production.user.trim() || !production.path.trim()) {
          setAlert({
            tone: "error",
            text: "SSH host, user, and remote WordPress path are required. Fill them on the SSH server step.",
          });
          return;
        }
        if (!production.url.trim()) {
          const guessed = guessSiteUrlFromSshHost(production.host);
          if (guessed) production = { ...production, url: guessed };
        }
        if (!production.url.trim()) {
          setAlert({
            tone: "error",
            text: "Add the live site URL (e.g. https://example.com) so wp-dev can fix database links after pull — or use an SSH hostname that looks like a domain.",
          });
          return;
        }
      }
      const staging = hasStagingServer
        ? data.staging
        : { ...STAGING_PLACEHOLDER, user: production.user || data.staging.user || "deploy" };
      const payload = toJson({ ...data, staging, production });
      const res = await saveWpDevConfig(payload);
      if (!res.ok) {
        const err = "error" in res ? res.error : "unknown";
        setAlert({
          tone: "error",
          text:
            err.includes("write_config_failed")
              ? "Save failed: write_config_failed. The host file may not be writable by the container. Run: chmod u+rw wp-dev.config.json and then save again."
              : `Save failed: ${err}. Check Activity log and logs/wp-dev-admin-api.log. If forbidden, unlock admin again.`,
        });
        return;
      }
      let extra = "";
      if (useProviderIntegration && data.simply?.account && providerApiKey.trim()) {
        const keyRes = await saveDockerEnvSecrets({
          WPDEV_SIMPLY_API_KEY: providerApiKey.trim(),
        });
        setProviderApiKey("");
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
      if (
        hasStagingServer &&
        data.staging.db?.host?.trim() &&
        data.staging.db?.name?.trim() &&
        data.staging.db?.user?.trim() &&
        data.staging.db?.password?.trim()
      ) {
        const dbSecretRes = await saveDockerEnvSecrets({
            WPDEV_STAGING_DB_HOST: data.staging.db.host.trim(),
            WPDEV_STAGING_DB_NAME: data.staging.db.name.trim(),
            WPDEV_STAGING_DB_USER: data.staging.db.user.trim(),
            WPDEV_STAGING_DB_PASSWORD: data.staging.db.password,
            ...(data.staging.db.prefix?.trim()
              ? { WPDEV_STAGING_DB_PREFIX: data.staging.db.prefix.trim() }
              : {}),
          });
        if (!dbSecretRes.ok) {
          extra += `\n\nStaging DB secrets were NOT saved to docker/.env: ${"error" in dbSecretRes ? dbSecretRes.error : "unknown"}.`;
        } else {
          extra +=
            "\n\nSaved staging DB credentials to docker/.env (gitignored local file).";
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
      goStep(4);
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

  const stagingDb = data.staging.db;
  const productionDb = data.production.db;
  const checklist: { status: ChecklistStatus; label: string; detail: string }[] = [
    {
      status: hasStagingServer ? "done" : ("todo" as ChecklistStatus),
      label: "Real staging server enabled",
      detail: hasStagingServer ? "Using real staging host/path/url." : "Enable real staging server first.",
    },
    {
      status:
        data.staging.host.trim() && data.staging.user.trim() && data.staging.path.trim() && data.staging.url.trim()
          ? ("done" as ChecklistStatus)
          : ("todo" as ChecklistStatus),
      label: "Staging SSH + URL configured",
      detail: "Need staging.host, staging.user, staging.path, staging.url.",
    },
    {
      status:
        stagingDb?.host?.trim() &&
        stagingDb?.name?.trim() &&
        stagingDb?.user?.trim() &&
        stagingDb?.password?.trim()
          ? ("done" as ChecklistStatus)
          : ("todo" as ChecklistStatus),
      label: "Dedicated staging DB configured",
      detail: "Need staging.db.host/name/user/password for one-command push bootstrap.",
    },
    {
      status:
        stagingDb?.host?.trim() &&
        stagingDb?.name?.trim() &&
        productionDb?.host?.trim() &&
        productionDb?.name?.trim() &&
        stagingDb.host.trim() === productionDb.host.trim() &&
        stagingDb.name.trim() === productionDb.name.trim()
          ? ("warn" as ChecklistStatus)
          : ("done" as ChecklistStatus),
      label: "Staging DB is different from production DB",
      detail:
        "Using same DB host+name as production is unsafe. Staging should use its own database.",
    },
    {
      status:
        data.staging.path.trim().startsWith("/") &&
        !data.staging.path.trim().includes("/public_html")
          ? ("warn" as ChecklistStatus)
          : ("done" as ChecklistStatus),
      label: "Staging path format looks compatible",
      detail:
        "On shared hosting, a relative path like `staging` often works better than `/staging`.",
    },
    {
      status:
        /^https:\/\//i.test(data.staging.url.trim()) && data.staging.url.includes(".")
          ? ("done" as ChecklistStatus)
          : ("todo" as ChecklistStatus),
      label: "Staging URL is HTTPS",
      detail: "Expected e.g. https://staging.example.com",
    },
  ];
  const readinessBlocking = checklist.filter((x) => x.status !== "done");
  const stepOneReady = Boolean(data.project.trim() && data.local.url.trim());
  const localUrlLooksValid = (() => {
    try {
      const u = new URL(data.local.url.trim());
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  })();
  const stagingReady = !hasStagingServer
    ? true
    : Boolean(
        data.staging.host.trim() &&
          data.staging.user.trim() &&
          data.staging.path.trim() &&
          data.staging.url.trim(),
      );

  const localLink = data.local.url.trim();
  const productionLink = data.production.url.trim();
  const stagingLink = hasStagingServer ? data.staging.url.trim() : "";
  const adminSelfLink = `${window.location.origin}/admin/`;
  const installLink = localLink ? `${localLink.replace(/\/$/, "")}/wp-admin/install.php` : "";
  const workflow = setupWorkflow ?? "pull";
  const skipStaging = skipStagingWizardStep(workflow, hasStagingServer);
  const permissionsOk =
    localStatus?.writable.wpContent &&
    localStatus?.writable.plugins &&
    localStatus?.writable.upgrade;
  const sshServerReady = Boolean(
    data.production.host.trim() &&
      data.production.user.trim() &&
      data.production.path.trim() &&
      (data.production.url.trim() || guessSiteUrlFromSshHost(data.production.host)),
  );

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
  const terminalPanel = (
    <TerminalEmbed
      terminalPort={terminalPort}
      terminalAuth={terminalAuth}
      secretsReady={terminalSecretsReady}
      secretsError={terminalSecretsError}
      showTerminal={showTerminal}
      onToggleShow={() => setShowTerminal((v) => !v)}
    />
  );

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap gap-2 text-xs">
        {STEP_LABELS.map((label, i) => {
          if (skipStaging && i === STAGING_STEP) return null;
          return (
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
              {label}
            </button>
          );
        })}
      </div>
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900/50">
        <div className="flex flex-wrap items-center gap-2">
          <span className={stepOneReady ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}>
            1) Local {stepOneReady ? "OK" : "TODO"}
          </span>
          <span
            className={
              sshServerReady || workflow === "local-only"
                ? "text-emerald-700 dark:text-emerald-300"
                : "text-amber-700 dark:text-amber-300"
            }
          >
            2) SSH {sshServerReady || workflow === "local-only" ? "OK" : "TODO"}
          </span>
          {!skipStaging && (
            <span className={stagingReady ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}>
              3) Staging {stagingReady ? "OK" : "optional"}
            </span>
          )}
          <span className="text-slate-500 dark:text-slate-400">{skipStaging ? "3" : "4"}) Save & pull</span>
          <span className="text-slate-500 dark:text-slate-400">{skipStaging ? "4" : "5"}) Done</span>
        </div>
      </div>

      {alertBox}
      {terminalRun && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-700 dark:bg-slate-900/50">
          <p className="font-semibold text-slate-800 dark:text-slate-100">
            Command output {terminalRun.running ? "(running...)" : "(finished)"}
          </p>
          <pre className="mt-2 max-h-64 overflow-auto rounded border border-slate-200 bg-white p-2 text-[11px] dark:border-slate-700 dark:bg-slate-950">
            {terminalRun.output || "No output yet."}
          </pre>
        </div>
      )}

      {step === 0 && (
        <div className="space-y-4">
          {localStatus?.needsSetup && (
            <div className="rounded-lg border-2 border-brand-500 bg-brand-50 p-4 dark:border-brand-600 dark:bg-brand-950/30">
              <p className="text-base font-bold text-brand-900 dark:text-brand-100">Getting started</p>
              <p className="mt-1 text-sm text-brand-800 dark:text-brand-200">
                This clone has no synced WordPress site yet. Complete this wizard, then pull from remote or install
                WordPress locally.
              </p>
              {!localStatus.adminBuilt && (
                <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">
                  Admin UI not built — from the repo root run:{" "}
                  <code className="rounded bg-white/80 px-1 dark:bg-slate-900">npm run setup</code>
                </p>
              )}
              {!permissionsOk && localStatus && (
                <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">
                  WordPress file permissions look wrong (plugins may fail to update). Run:{" "}
                  <code className="rounded bg-white/80 px-1 dark:bg-slate-900">npm run wp-dev -- up</code>
                </p>
              )}
              {isMacBrowser() && (
                <p className="mt-2 text-xs text-brand-800 dark:text-brand-200">
                  macOS: from the repo folder run{" "}
                  <code className="rounded bg-white/80 px-1 dark:bg-slate-900">npm run quickstart</code>{" "}
                  — checks Docker Desktop, starts the stack, and opens this wizard. Keep the project under your home
                  folder so Docker can bind-mount <code className="rounded bg-white/80 px-1 dark:bg-slate-900">wordpress/</code>.
                </p>
              )}
            </div>
          )}
          <fieldset className="space-y-2 rounded-lg border border-slate-200 p-4 dark:border-slate-700">
            <legend className="px-1 text-sm font-semibold text-slate-800 dark:text-slate-100">
              What do you want to do?
            </legend>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-900/50">
              <input
                type="radio"
                name="setup-workflow"
                checked={workflow === "pull"}
                onChange={() => {
                  setSetupWorkflow("pull");
                  logAdmin("info", "Wizard: workflow → pull from remote");
                }}
                className="mt-1"
              />
              <span>
                <span className="block text-sm font-medium text-slate-900 dark:text-white">
                  Sync from my server (SSH only)
                </span>
                <span className="text-xs text-slate-600 dark:text-slate-400">
                  Set up SSH key, one remote path, save, then pull — no staging domain needed.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-900/50">
              <input
                type="radio"
                name="setup-workflow"
                checked={workflow === "local-only"}
                onChange={() => {
                  setSetupWorkflow("local-only");
                  logAdmin("info", "Wizard: workflow → local-only");
                }}
                className="mt-1"
              />
              <span>
                <span className="block text-sm font-medium text-slate-900 dark:text-white">
                  New local WordPress site only
                </span>
                <span className="text-xs text-slate-600 dark:text-slate-400">
                  Skip production SSH for now. Save config, then open the WordPress installer.
                </span>
              </span>
            </label>
          </fieldset>
          <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100">
            <p className="font-semibold">What to do on this step</p>
            <ol className="mt-1 list-inside list-decimal space-y-1">
              <li>Confirm <code>Project id</code> (used for compose project naming).</li>
              <li>Confirm <code>Local site URL</code> matches your current localhost port.</li>
              <li>
                Click <strong>Next</strong>
                {workflow === "pull"
                  ? " — SSH key + server path only (staging is optional later)."
                  : " (SSH step is optional)."}
              </li>
            </ol>
            <p className="mt-2">
              Status: {stepOneReady ? "Ready to continue" : "Fill required fields before continuing"}.
            </p>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            This step defines local project identity and localhost URL used after sync/install.
          </p>
          <label className="block">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Project id *</span>
            <input className={input} value={data.project} onChange={(e) => patch("project", e.target.value)} />
            {!data.project.trim() && (
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Required: used for docker compose project naming.</p>
            )}
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Local site URL *</span>
            <input className={input} value={data.local.url} onChange={(e) => patchLocal("url", e.target.value)} />
            {!localUrlLooksValid && (
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Use full URL, e.g. http://localhost:8891</p>
            )}
          </label>
          <p className="text-xs text-slate-500">
            After save, open this URL in another tab to run the WordPress installer (or continue after a pull).
          </p>
          <details className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <summary className="cursor-pointer text-xs font-medium text-slate-700 dark:text-slate-200">
              Terminal settings (required before one-click run)
            </summary>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="block">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Terminal login (user:password)</span>
                <input
                  className={input}
                  type="text"
                  autoComplete="off"
                  value={terminalAuth}
                  onChange={(e) => setTerminalAuth(e.target.value)}
                  placeholder="wpdev:wpdev"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Terminal working directory</span>
                <input
                  className={input}
                  type="text"
                  autoComplete="off"
                  value={terminalWorkdir}
                  onChange={(e) => setTerminalWorkdir(e.target.value)}
                  placeholder="/workspace"
                />
              </label>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={terminalSettingsBusy}
                onClick={async () => {
                  setTerminalSettingsBusy(true);
                  setTerminalSettingsMessage(null);
                  try {
                    const saved = await saveTerminalSettingsNow();
                    if (!saved.ok) {
                      setTerminalSettingsMessage({ tone: "error", text: `Could not save terminal settings: ${saved.error}` });
                      return;
                    }
                    setTerminalSettingsMessage({
                      tone: "success",
                      text: "Saved terminal settings to docker/.env. Restart stack: wp-dev down && wp-dev up",
                    });
                  } finally {
                    setTerminalSettingsBusy(false);
                  }
                }}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
              >
                {terminalSettingsBusy ? "Saving terminal..." : "Save terminal settings"}
              </button>
            </div>
            {terminalSettingsMessage && (
              <div
                className={`mt-2 rounded border px-3 py-2 text-xs ${
                  terminalSettingsMessage.tone === "success"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100"
                    : "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100"
                }`}
              >
                {terminalSettingsMessage.text}
              </div>
            )}
          </details>
          <details className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <summary className="cursor-pointer text-xs font-medium text-slate-700 dark:text-slate-200">
              Advanced local settings
            </summary>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="block">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">local.path</span>
                <input className={input} value={data.local.path} onChange={(e) => patchLocal("path", e.target.value)} />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">local.composeFile</span>
                <input className={input} value={data.local.composeFile} onChange={(e) => patchLocal("composeFile", e.target.value)} />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">local.composeService</span>
                <input className={input} value={data.local.composeService} onChange={(e) => patchLocal("composeService", e.target.value)} />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">local.wpRoot</span>
                <input className={input} value={data.local.wpRoot} onChange={(e) => patchLocal("wpRoot", e.target.value)} />
              </label>
              <label className="block md:col-span-2">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">local.composeProjectName (optional)</span>
                <input
                  className={input}
                  value={data.local.composeProjectName ?? ""}
                  onChange={(e) => patchLocal("composeProjectName", e.target.value)}
                />
              </label>
            </div>
          </details>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4">
          {workflow === "local-only" && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-100">
              Optional for a local-only site — skip to Save & sync. Add SSH here later when you want to pull from a
              server.
            </p>
          )}
          {workflow === "pull" && (
            <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-100">
              <p className="font-semibold">Quick path</p>
              <ol className="mt-1 list-inside list-decimal space-y-1">
                <li>Generate/upload SSH key below and run the SSH test.</li>
                <li>Fill SSH host, user, and the WordPress folder path on the server.</li>
                <li>
                  Live site URL is only for fixing links in the database — often{" "}
                  <code>https://yourdomain.com</code> (auto-guessed from SSH host when possible).
                </li>
                <li>Next → Save & sync → run pull.</li>
              </ol>
            </div>
          )}
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {workflow === "pull"
              ? "One SSH connection — no separate staging/production domains required."
              : "Remote SSH (optional for local-only)."}
          </p>
          <label className="block">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
              SSH host{workflow === "pull" ? " *" : ""}
            </span>
            <input
              className={input}
              placeholder="ssh.example.com or example.com"
              value={data.production.host}
              onChange={(e) => patchRemote("production", "host", e.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
              SSH user{workflow === "pull" ? " *" : ""}
            </span>
            <input
              className={input}
              placeholder="deploy"
              value={data.production.user}
              onChange={(e) => patchRemote("production", "user", e.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
              WordPress path on server{workflow === "pull" ? " *" : ""}
            </span>
            <input
              className={input}
              placeholder="/var/www/live or public_html"
              value={data.production.path}
              onChange={(e) => patchRemote("production", "path", e.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
              Live site URL {workflow === "pull" ? "(optional if SSH host is a domain)" : ""}
            </span>
            <input
              className={input}
              placeholder={
                guessSiteUrlFromSshHost(data.production.host) || "https://example.com"
              }
              value={data.production.url}
              onChange={(e) => patchRemote("production", "url", e.target.value)}
            />
            {workflow === "pull" &&
              !data.production.url.trim() &&
              guessSiteUrlFromSshHost(data.production.host) && (
                <p className="mt-1 text-xs text-slate-500">
                  Will use {guessSiteUrlFromSshHost(data.production.host)} on save.
                </p>
              )}
          </label>
          {terminalPanel}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-200">
            <p className="font-semibold text-slate-800 dark:text-slate-100">SSH key setup (required)</p>
            <p className="mt-1 font-semibold text-amber-700 dark:text-amber-300">
              Required: upload the generated public key (<code>~/.ssh/id_ed25519.pub</code>) to your hosting SSH keys before pull/push.
            </p>
            <ol className="mt-2 list-inside list-decimal space-y-1">
              <li>Create keypair: <code>ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -C "you@host"</code></li>
              <li>Add <code>~/.ssh/id_ed25519.pub</code> to your hosting SSH keys in the control panel.</li>
              <li>Use the hosting SSH hostname + user in fields above (often not the public domain).</li>
              <li>Run the test command in terminal; it must work without password prompts.</li>
            </ol>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void runTerminalCommand(buildKeypairCommand(), "plain", "generate_keypair")}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
              >
                Generate SSH keypair
              </button>
              <button
                type="button"
                onClick={() =>
                  void runTerminalCommand(buildSshTestCommand("production"), "plain", "ssh_test", {
                    user: data.production.user.trim(),
                    host: data.production.host.trim(),
                  })
                }
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
              >
                Run SSH test (production)
              </button>
            </div>
            {terminalPrep && (
              <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-xs dark:border-slate-700 dark:bg-slate-900">
                <p className="font-semibold text-slate-800 dark:text-slate-100">
                  Terminal command ready {terminalPrep.copied ? "(copied)" : "(copy manually)"}
                </p>
                <p className="mt-1 text-slate-600 dark:text-slate-300">{terminalPrep.message}</p>
              </div>
            )}
          </div>
          <details className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <summary className="cursor-pointer text-xs font-medium text-slate-700 dark:text-slate-200">
              Optional: production.db bootstrap settings
            </summary>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {(["host", "name", "user", "password", "prefix"] as const).map((key) => (
                <label key={key} className="block capitalize">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                    production.db.{key}
                  </span>
                  <input
                    className={input}
                    type={key === "password" ? "password" : "text"}
                    value={String(
                      key === "prefix"
                        ? (data.production.db?.prefix ?? "")
                        : (data.production.db?.[key] ?? ""),
                    )}
                    onChange={(e) => patchRemoteDb("production", key, e.target.value)}
                  />
                </label>
              ))}
            </div>
          </details>
          <details className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <summary className="cursor-pointer text-xs font-medium text-slate-700 dark:text-slate-200">
              Advanced production SSH settings
            </summary>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="block">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">production.port (optional)</span>
                <input
                  className={input}
                  type="number"
                  min={1}
                  max={65535}
                  value={data.production.port ?? ""}
                  onChange={(e) => patchRemotePort("production", e.target.value)}
                />
              </label>
              <label className="block md:col-span-2">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">production.identityFile (optional)</span>
                <input
                  className={input}
                  value={data.production.identityFile ?? ""}
                  onChange={(e) => patchRemote("production", "identityFile", e.target.value)}
                  placeholder="~/.ssh/id_ed25519"
                />
              </label>
            </div>
          </details>
        </div>
      )}

      {step === STAGING_STEP && (
        <div className="space-y-4">
          {skipStaging && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/40">
              <p className="text-sm font-medium text-emerald-900 dark:text-emerald-100">
                Staging is not required for localhost sync.
              </p>
              <p className="mt-1 text-xs text-emerald-800 dark:text-emerald-200">
                Enable below only if you use a separate staging server later.
              </p>
              <button
                type="button"
                onClick={goNext}
                className="mt-3 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
              >
                Skip to Save & sync →
              </button>
            </div>
          )}
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
              {terminalPanel}
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-200">
                <p className="font-semibold text-slate-800 dark:text-slate-100">Test staging SSH access</p>
                <p className="mt-1 font-semibold text-amber-700 dark:text-amber-300">
                  Required: ensure this key is uploaded on the staging host too (or shared host account) before pull/push.
                </p>
                <p className="mt-1">
                  Run this check first. Expected output: remote path listing + WP-CLI info.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      void runTerminalCommand(buildSshTestCommand("staging"), "plain", "ssh_test", {
                        user: data.staging.user.trim(),
                        host: data.staging.host.trim(),
                      })
                    }
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                  >
                    Run SSH test (staging)
                  </button>
                </div>
                {terminalPrep && (
                  <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-xs dark:border-slate-700 dark:bg-slate-900">
                    <p className="font-semibold text-slate-800 dark:text-slate-100">
                      Terminal command ready {terminalPrep.copied ? "(copied)" : "(copy manually)"}
                    </p>
                    <p className="mt-1 text-slate-600 dark:text-slate-300">{terminalPrep.message}</p>
                  </div>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={sslCheckBusy}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                    onClick={async () => {
                      setSslCheckBusy(true);
                      try {
                        const r = await checkStagingHttps({ url: data.staging.url.trim() || undefined });
                        if (!r.ok) {
                          setAlert({
                            tone: "error",
                            text: `Staging HTTPS check failed: ${r.error}${r.detail ? `\n${r.detail}` : ""}`,
                          });
                          return;
                        }
                        const lines = [
                          `HTTPS ${r.url}: ${r.https.ok ? "OK" : "NOT OK"} (HTTP ${r.https.status})`,
                          `HTTP -> HTTPS redirect: ${r.http.redirectsToHttps ? "YES" : "NO"} (HTTP ${r.http.status})`,
                        ];
                        if (!r.http.redirectsToHttps) {
                          lines.push("Tip: configure redirect from http to https in hosting settings.");
                        }
                        if (!r.https.ok) {
                          lines.push(
                            "Tip: ensure SSL cert is issued for staging hostname and DNS has propagated.",
                          );
                        }
                        setAlert({
                          tone: r.https.ok ? "success" : "info",
                          text: lines.join("\n"),
                        });
                      } finally {
                        setSslCheckBusy(false);
                      }
                    }}
                  >
                    {sslCheckBusy ? "Checking HTTPS..." : "Verify staging HTTPS"}
                  </button>
                  <button
                    type="button"
                    disabled={domainCheckBusy}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                    onClick={async () => {
                      setDomainCheckBusy(true);
                      try {
                        const r = await checkStagingDomain({ url: data.staging.url.trim() || undefined });
                        if (!r.ok) {
                          setDomainCheckResult(null);
                          setAlert({
                            tone: "error",
                            text: `Staging domain check failed: ${r.error}${r.detail ? `\n${r.detail}` : ""}`,
                          });
                          return;
                        }
                        setDomainCheckResult({
                          host: r.host,
                          dnsOk: r.dns.ok,
                          dnsRecords: r.dns.records,
                          httpsOk: r.https.ok,
                          httpsStatus: r.https.status,
                          redirectsToHttps: r.http.redirectsToHttps,
                          httpStatus: r.http.status,
                          finalHostMatches: r.finalHostMatches,
                          hints: r.hints,
                          checkedAtIso: new Date().toISOString(),
                        });
                        const lines: string[] = [
                          `Host: ${r.host}`,
                          `DNS records found: ${r.dns.ok ? "YES" : "NO"}${r.dns.records.length ? ` (${r.dns.records.join(", ")})` : ""}`,
                          `HTTPS reachable: ${r.https.ok ? "YES" : "NO"} (HTTP ${r.https.status})`,
                          `HTTP -> HTTPS redirect: ${r.http.redirectsToHttps ? "YES" : "NO"} (HTTP ${r.http.status})`,
                          `Final host matches staging URL: ${r.finalHostMatches ? "YES" : "NO"}`,
                          "",
                          ...r.hints.map((h) => `- ${h}`),
                        ];
                        const healthy =
                          r.dns.ok && r.https.ok && r.http.redirectsToHttps && r.finalHostMatches;
                        setAlert({
                          tone: healthy ? "success" : "info",
                          text: `Staging domain check:\n${lines.join("\n")}`,
                        });
                      } finally {
                        setDomainCheckBusy(false);
                      }
                    }}
                  >
                    {domainCheckBusy ? "Checking domain..." : "Test staging domain setup"}
                  </button>
                </div>
                {domainCheckResult && (
                  <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-xs dark:border-slate-700 dark:bg-slate-900">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="font-semibold text-slate-800 dark:text-slate-100">Staging domain status</p>
                      <p className="text-[11px] text-slate-500">
                        Checked {new Date(domainCheckResult.checkedAtIso).toLocaleString()}
                      </p>
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
                      <p className="text-slate-600 dark:text-slate-300">
                        Host: <span className="font-medium">{domainCheckResult.host}</span>
                      </p>
                      <p className={domainCheckResult.dnsOk ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}>
                        DNS: {domainCheckResult.dnsOk ? "OK" : "Missing"}
                      </p>
                      <p className={domainCheckResult.httpsOk ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}>
                        HTTPS: {domainCheckResult.httpsOk ? "OK" : "Not OK"} (HTTP {domainCheckResult.httpsStatus})
                      </p>
                      <p className={domainCheckResult.redirectsToHttps ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}>
                        HTTP→HTTPS: {domainCheckResult.redirectsToHttps ? "Yes" : "No"} (HTTP {domainCheckResult.httpStatus})
                      </p>
                      <p className={domainCheckResult.finalHostMatches ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}>
                        Final host match: {domainCheckResult.finalHostMatches ? "Yes" : "No"}
                      </p>
                    </div>
                    {domainCheckResult.dnsRecords.length > 0 && (
                      <p className="mt-2 text-slate-600 dark:text-slate-300">
                        DNS records: {domainCheckResult.dnsRecords.join(", ")}
                      </p>
                    )}
                    <ul className="mt-2 list-inside list-disc space-y-1 text-slate-600 dark:text-slate-300">
                      {domainCheckResult.hints.map((hint) => (
                        <li key={hint}>{hint}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="mt-2 text-xs text-slate-500">
                  SSL checklist: DNS for staging hostname resolves, hosting/vhost serves the hostname, cert is issued,
                  and HTTP redirects to HTTPS.
                </p>
              </div>
              <details className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <summary className="cursor-pointer text-xs font-medium text-slate-700 dark:text-slate-200">
                  Required for push staging: staging.db settings
                </summary>
                <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
                  Use a dedicated staging DB (own name/user/password), not the production DB. Prefix is optional:
                  push staging will reuse your local prefix when possible, otherwise default to <code>wp_</code>.
                </p>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  {(["host", "name", "user", "password", "prefix"] as const).map((key) => (
                    <label key={key} className="block capitalize">
                      <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                        staging.db.{key}
                      </span>
                      <input
                        className={input}
                        type={key === "password" ? "password" : "text"}
                        value={String(
                          key === "prefix"
                            ? (data.staging.db?.prefix ?? "")
                            : (data.staging.db?.[key] ?? ""),
                        )}
                        onChange={(e) => patchRemoteDb("staging", key, e.target.value)}
                      />
                    </label>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={dbSaveBusy}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                    onClick={async () => {
                      setDbSaveBusy(true);
                      setDbSaveMessage(null);
                      try {
                        const saved = await saveStagingDbSecretsNow();
                        if (!saved.ok) {
                          setDbSaveMessage({ tone: "error", text: `Could not save staging DB secrets: ${saved.error}` });
                          return;
                        }
                        setDbSaveMessage({
                          tone: "success",
                          text: "Saved staging DB secrets to local docker/.env (gitignored).",
                        });
                      } finally {
                        setDbSaveBusy(false);
                      }
                    }}
                  >
                    {dbSaveBusy ? "Saving DB..." : "Save staging DB locally"}
                  </button>
                  <button
                    type="button"
                    disabled={dbCheckBusy}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                    onClick={async () => {
                      const dbHost = data.staging.db?.host?.trim() || "";
                      const dbName = data.staging.db?.name?.trim() || "";
                      const dbUser = data.staging.db?.user?.trim() || "";
                      const dbPass = data.staging.db?.password || "";
                      if (!dbHost || !dbName || !dbUser || !dbPass) {
                        const msg = "Fill staging.db.host, name, user, and password before running DB check.";
                        setDbCheckMessage({ tone: "error", text: msg });
                        setAlert({ tone: "error", text: msg });
                        return;
                      }
                      const saved = await saveStagingDbSecretsNow();
                      if (!saved.ok) {
                        const msg = `Could not save staging DB secrets before check: ${saved.error}`;
                        setDbCheckMessage({ tone: "error", text: msg });
                        setAlert({ tone: "error", text: msg });
                        return;
                      }
                      setDbCheckMessage(null);
                      setDbCheckBusy(true);
                      try {
                        const r = await checkStagingDbConnection({
                          host: dbHost,
                          name: dbName,
                          user: dbUser,
                          password: dbPass,
                          port: 3306,
                        });
                        if (r.ok) {
                          const successText =
                            `Staging DB connection OK (${r.database ?? "database"}).` +
                            (r.server ? ` Server: ${r.server}` : "");
                          setDbCheckMessage({ tone: "success", text: successText });
                          setAlert({
                            tone: "success",
                            text:
                              `Staging DB connection OK (${r.database ?? "database"}).` +
                              (r.server ? `\nServer: ${r.server}` : ""),
                          });
                        } else {
                          const errorText = `Staging DB check failed: ${r.error}${r.detail ? ` — ${r.detail}` : ""}`;
                          setDbCheckMessage({ tone: "error", text: errorText });
                          setAlert({
                            tone: "error",
                            text: `Staging DB check failed: ${r.error}${r.detail ? `\n${r.detail}` : ""}`,
                          });
                        }
                      } finally {
                        setDbCheckBusy(false);
                      }
                    }}
                  >
                    {dbCheckBusy ? "Checking DB..." : "Check staging DB connection"}
                  </button>
                </div>
                {dbSaveMessage && (
                  <div
                    className={`mt-2 rounded border px-3 py-2 text-xs ${
                      dbSaveMessage.tone === "success"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100"
                        : "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100"
                    }`}
                  >
                    {dbSaveMessage.text}
                  </div>
                )}
                {dbCheckMessage && (
                  <div
                    className={`mt-2 rounded border px-3 py-2 text-xs ${
                      dbCheckMessage.tone === "success"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100"
                        : "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100"
                    }`}
                  >
                    {dbCheckMessage.text}
                  </div>
                )}
              </details>
              <details className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <summary className="cursor-pointer text-xs font-medium text-slate-700 dark:text-slate-200">
                  Advanced staging SSH settings
                </summary>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <label className="block">
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-400">staging.port (optional)</span>
                    <input
                      className={input}
                      type="number"
                      min={1}
                      max={65535}
                      value={data.staging.port ?? ""}
                      onChange={(e) => patchRemotePort("staging", e.target.value)}
                    />
                  </label>
                  <label className="block md:col-span-2">
                    <span className="text-xs font-medium text-slate-600 dark:text-slate-400">staging.identityFile (optional)</span>
                    <input
                      className={input}
                      value={data.staging.identityFile ?? ""}
                      onChange={(e) => patchRemote("staging", "identityFile", e.target.value)}
                      placeholder="~/.ssh/id_ed25519"
                    />
                  </label>
                </div>
              </details>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/40">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                  Active Staging Checklist
                </p>
                <div className="space-y-2">
                  {checklist.map((item) => (
                    <div key={item.label} className="rounded border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900">
                      <div className="flex items-center justify-between gap-2">
                        <span className={checklistTone(item.status)}>{item.label}</span>
                        <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${checklistTone(item.status)}`}>
                          {checklistBadge(item.status)}
                        </span>
                      </div>
                      <p className="mt-1 text-slate-500 dark:text-slate-400">{item.detail}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-3 rounded border border-slate-200 bg-white p-2 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                  Recommended flow: save config, then run <code>npm run wp-dev -- push staging</code>, then run
                  {" "}Verify staging HTTPS.
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={readinessBusy}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                    onClick={() => {
                      setReadinessBusy(true);
                      try {
                        if (readinessBlocking.length === 0) {
                          setAlert({
                            tone: "success",
                            text:
                              "Staging readiness check passed.\n" +
                              "You can run: npm run wp-dev -- push staging",
                          });
                          return;
                        }
                        const items = readinessBlocking.map((x) => `- ${x.label}: ${x.detail}`).join("\n");
                        setAlert({
                          tone: "error",
                          text:
                            "Staging readiness check failed. Fix these items first:\n" +
                            items +
                            "\n\nThen rerun readiness check and push staging.",
                        });
                      } finally {
                        setReadinessBusy(false);
                      }
                    }}
                  >
                    {readinessBusy ? "Checking..." : "Run readiness check"}
                  </button>
                </div>
              </div>
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

      {step === 99 && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            This step is optional. Skip it unless you need provider API integration.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={useProviderIntegration}
              onChange={(e) => {
                const v = e.target.checked;
                logAdmin("info", `Wizard: Simply.com block → ${v ? "on" : "off"}`);
                setUseProviderIntegration(v);
                if (!v) setData((d) => ({ ...d, simply: undefined }));
              }}
              className="rounded border-slate-300"
            />
            Enable optional provider integration (account + optional API key). Key is saved to host{" "}
            <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">docker/.env</code> as{" "}
            <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">WPDEV_SIMPLY_API_KEY</code>, not in wp-dev.config.json.
          </label>
          {useProviderIntegration && (
            <div className="space-y-3">
              <label className="block">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-400">provider.account (optional)</span>
                <input
                  className={input}
                  placeholder="Provider account id (e.g. S123456)"
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
                  Provider API key (optional; saved to docker/.env on Save)
                </span>
                <input
                  className={input}
                  type="password"
                  autoComplete="off"
                  placeholder="Leave empty to keep existing key on server"
                  value={providerApiKey}
                  onChange={(e) => setProviderApiKey(e.target.value)}
                />
              </label>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-200">
                Server key status:{" "}
                {providerKeyPresent === null ? "unknown" : providerKeyPresent ? "present" : "missing"}.
                {" "}
                {providerKeyPresent === false ? "Save API key below, then verify." : "You can verify API access now."}
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                <strong>Manual setup required:</strong> do staging setup in your hosting control panel.
                <ol className="mt-2 list-inside list-decimal space-y-1">
                  <li>Create/verify subdomain (for example <code className="rounded bg-amber-100 px-1 dark:bg-amber-900">staging.example.com</code>).</li>
                  <li>Map subdomain to the correct folder (for example <code className="rounded bg-amber-100 px-1 dark:bg-amber-900">/staging</code>).</li>
                  <li>Issue/verify SSL certificate for the staging hostname.</li>
                  <li>Set <code className="rounded bg-amber-100 px-1 dark:bg-amber-900">staging.url</code> in wizard to that HTTPS hostname.</li>
                </ol>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={providerKeySaveBusy}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                  onClick={async () => {
                    setProviderKeySaveBusy(true);
                    setProviderKeySaveMessage(null);
                    try {
                      const saved = await saveSimplyKeyNow();
                      if (!saved.ok) {
                        setProviderKeySaveMessage({
                          tone: "error",
                          text: `Could not save provider API key: ${saved.error}`,
                        });
                        return;
                      }
                      setProviderApiKey("");
                      setProviderKeySaveMessage({
                        tone: "success",
                        text: "Saved provider API key to local docker/.env (gitignored).",
                      });
                    } finally {
                      setProviderKeySaveBusy(false);
                    }
                  }}
                >
                  {providerKeySaveBusy ? "Saving key..." : "Save provider API key locally"}
                </button>
                <button
                  type="button"
                  disabled={providerApiTestBusy}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                  onClick={async () => {
                    setProviderApiTestBusy(true);
                    try {
                      const r = await verifySimplyApi({
                        account: data.simply?.account?.trim() || undefined,
                        apiKey: providerApiKey.trim() || undefined,
                      });
                      if (r.ok) {
                        setAlert({
                          tone: "success",
                          text: `Provider API verified (HTTP ${r.status}).`,
                        });
                        return;
                      }
                      const detail = r.detail ? `\n${r.detail}` : "";
                      setAlert({
                        tone: "error",
                        text: `Provider API verify failed: ${r.error}${detail}`,
                      });
                    } finally {
                      setProviderApiTestBusy(false);
                    }
                  }}
                >
                  {providerApiTestBusy ? "Verifying..." : "Verify provider API now"}
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                  onClick={() => void refreshSimplyStatus()}
                >
                  Refresh key status
                </button>
                <a
                  href="https://www.simply.com/en/controlpanel"
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                >
                  Open hosting control panel
                </a>
              </div>
              {providerKeySaveMessage && (
                <div
                  className={`rounded border px-3 py-2 text-xs ${
                    providerKeySaveMessage.tone === "success"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100"
                      : "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100"
                  }`}
                >
                  {providerKeySaveMessage.text}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          {terminalPanel}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-900/40">
            <p className="mb-2 font-medium text-slate-800 dark:text-slate-200">Run these in terminal</p>
            <p className="mb-3 whitespace-pre-line text-xs text-slate-600 dark:text-slate-400">{PULL_TERMINAL_HINT}</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void runTerminalCommand("npm run wp-dev -- pull production", "pull")}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
              >
                Run: pull production to localhost
              </button>
              <button
                type="button"
                disabled={!hasStagingServer}
                onClick={() => void runTerminalCommand("npm run wp-dev -- pull staging", "pull")}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
              >
                Run: pull staging to localhost
              </button>
              <button
                type="button"
                disabled={!hasStagingServer}
                onClick={() => void runTerminalCommand("npm run wp-dev -- push staging", "push")}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
              >
                Run: push localhost to staging
              </button>
              <button
                type="button"
                onClick={() => void runTerminalCommand("npm run wp-dev -- push production", "push")}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
              >
                Run: push localhost to production
              </button>
            </div>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Use <strong>Unlock admin</strong> (top right) once per session before save. Token lives in{" "}
            <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">docker/.env</code> as{" "}
            <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">WPDEV_ADMIN_SAVE_TOKEN</code>.
          </p>
          <pre className="max-h-64 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-700 dark:bg-slate-950">
            {JSON.stringify(
              toJson({
                ...data,
                staging: hasStagingServer
                  ? data.staging
                  : { ...STAGING_PLACEHOLDER, user: data.production.user || "deploy" },
                production: (() => {
                  let p =
                    workflow === "local-only" && !data.production.host.trim()
                      ? { ...PRODUCTION_PLACEHOLDER, user: data.production.user.trim() || "deploy" }
                      : { ...data.production };
                  if (workflow === "pull" && !p.url.trim()) {
                    const guessed = guessSiteUrlFromSshHost(p.host);
                    if (guessed) p = { ...p, url: guessed };
                  }
                  return p;
                })(),
                simply: data.simply,
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
          <p className="text-xs text-slate-500">
            If save returns permission denied, the container user may not own <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">wp-dev.config.json</code> on the host — for local dev try{" "}
            <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">chmod u+w wp-dev.config.json</code> or run{" "}
            <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">wp-dev init</code> from the terminal instead.
          </p>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm dark:border-emerald-900 dark:bg-emerald-950/40">
            <p className="font-semibold text-emerald-900 dark:text-emerald-100">Next steps</p>
            {workflow === "pull" && !localStatus?.hasSyncedContent && (
              <ol className="mt-2 list-inside list-decimal space-y-1 text-emerald-900 dark:text-emerald-100">
                <li>
                  Go to the <strong>Save</strong> step and click <strong>Run: pull production to localhost</strong>{" "}
                  (or use the Terminal tab).
                </li>
                <li>When pull finishes, open Localhost below to verify the site.</li>
                <li>Plugin updates need correct permissions — if they fail, run{" "}
                  <code className="rounded bg-white/60 px-1 dark:bg-slate-900">npm run wp-dev -- up</code>.
                </li>
              </ol>
            )}
            {workflow === "local-only" && !localStatus?.wpInstalled && (
              <ol className="mt-2 list-inside list-decimal space-y-1 text-emerald-900 dark:text-emerald-100">
                <li>Open the WordPress installer link below and complete setup.</li>
                <li>Return here anytime for pull/push commands and backups.</li>
              </ol>
            )}
            {localStatus?.hasSyncedContent && localStatus.wpInstalled && (
              <p className="mt-2 text-emerald-900 dark:text-emerald-100">
                Your local site looks ready. Open the links below to verify staging and production.
              </p>
            )}
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Open these links to verify your environment after save/sync.
          </p>
          <div className="grid gap-3">
            <a
              href={adminSelfLink}
              className="rounded-lg border-2 border-brand-500 bg-brand-50 px-4 py-3 text-sm font-medium text-brand-900 dark:border-brand-600 dark:bg-brand-950/40 dark:text-brand-100"
            >
              wp-dev admin (this wizard): {adminSelfLink}
            </a>
            {installLink && !localStatus?.wpInstalled && (
              <a
                href={installLink}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-900"
              >
                WordPress installer: {installLink}
              </a>
            )}
            <a
              href={localLink || "#"}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-900"
            >
              Localhost: {localLink || "Not set"}
            </a>
            <a
              href={stagingLink || "#"}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-900"
            >
              Staging: {stagingLink || "Not set"}
            </a>
            <a
              href={productionLink || "#"}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm dark:border-slate-700 dark:bg-slate-900"
            >
              Production: {productionLink || "Not set"}
            </a>
          </div>
        </div>
      )}

      <div className="flex justify-between border-t border-slate-100 pt-4 dark:border-slate-800">
        <button
          type="button"
          disabled={step === 0}
          onClick={goPrev}
          className="text-sm text-slate-600 hover:text-slate-900 disabled:opacity-40 dark:text-slate-400"
        >
          ← Previous
        </button>
        <button
          type="button"
          disabled={step === STEP_LABELS.length - 1}
          onClick={goNext}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
        >
          {step === STEP_LABELS.length - 1 ? "Finish" : "Next →"}
        </button>
      </div>
    </div>
  );
}

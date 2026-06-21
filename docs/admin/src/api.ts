import { logAdmin } from "./adminLog";
import { buildAdminApiHeaders, setAdminNonce } from "./adminAuthState";
import { validateWpDevConfigJson } from "./validateConfig";

/** @deprecated Migrated to HttpOnly session — cleared after successful unlock. */
export const WPDEV_ADMIN_TOKEN_LS_KEY = "wpdev-admin-save-token";

export function readStoredAdminSaveToken(): string {
  try {
    return typeof localStorage !== "undefined" ? localStorage.getItem(WPDEV_ADMIN_TOKEN_LS_KEY) ?? "" : "";
  } catch {
    return "";
  }
}

export function writeStoredAdminSaveToken(value: string): void {
  try {
    if (typeof localStorage === "undefined") return;
    const t = value.trim();
    if (t) localStorage.setItem(WPDEV_ADMIN_TOKEN_LS_KEY, t);
    else localStorage.removeItem(WPDEV_ADMIN_TOKEN_LS_KEY);
  } catch {
    /* ignore quota / private mode */
  }
}

export type AdminAuthStatusResponse =
  | { ok: true; tokenConfigured: boolean; authenticated: boolean; nonce?: string }
  | { ok: false; error: string };

export async function fetchAdminAuthStatus(): Promise<AdminAuthStatusResponse> {
  try {
    const res = await fetch(apiPhpUrl("auth-status"), {
      method: "GET",
      credentials: "same-origin",
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok || data.ok !== true) {
      setAdminNonce(null);
      return { ok: false, error: String(data.error ?? `HTTP ${res.status}`) };
    }
    const authenticated = Boolean(data.authenticated);
    const nonce = typeof data.nonce === "string" ? data.nonce : null;
    setAdminNonce(authenticated ? nonce : null);
    return {
      ok: true,
      tokenConfigured: Boolean(data.tokenConfigured),
      authenticated,
      nonce: nonce ?? undefined,
    };
  } catch (e) {
    setAdminNonce(null);
    return { ok: false, error: e instanceof Error ? e.message : "network_error" };
  }
}

export async function bootstrapLocalAdminSession(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  try {
    const res = await fetch(apiPhpUrl("auth-bootstrap"), {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok || data.ok !== true) {
      const detail = typeof data.detail === "string" ? `: ${data.detail}` : "";
      return { ok: false, error: `${String(data.error ?? `HTTP ${res.status}`)}${detail}` };
    }
    const nonce = typeof data.nonce === "string" ? data.nonce : null;
    setAdminNonce(nonce);
    logAdmin("info", "bootstrapLocalAdminSession: local session established");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network_error" };
  }
}

export async function unlockAdminSession(
  token: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(apiPhpUrl("auth"), {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: token.trim() }),
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok || data.ok !== true) {
      const detail = typeof data.detail === "string" ? `: ${data.detail}` : "";
      return { ok: false, error: `${String(data.error ?? `HTTP ${res.status}`)}${detail}` };
    }
    const nonce = typeof data.nonce === "string" ? data.nonce : null;
    setAdminNonce(nonce);
    logAdmin("info", "unlockAdminSession: session established");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network_error" };
  }
}

export async function logoutAdminSession(): Promise<void> {
  try {
    await fetch(apiPhpUrl("logout"), {
      method: "POST",
      credentials: "same-origin",
      headers: buildAdminApiHeaders({ "Content-Type": "application/json" }),
      body: "{}",
    });
  } finally {
    setAdminNonce(null);
  }
}

/** Same-origin /admin/api.php (Docker) or dev proxy to WP port. */
export function apiPhpUrl(
  action:
    | "load"
    | "save"
    | "save-docker-env"
    | "docker-env-public"
    | "simply-status"
    | "terminal-runner-secrets"
    | "staging-db-secrets"
    | "simply-test"
    | "staging-https-check"
    | "staging-domain-check"
    | "staging-db-check"
    | "local-status"
    | "auth-status"
    | "auth"
    | "auth-bootstrap"
    | "logout"
    | "runner-health"
    | "runner-run"
    | "runner-status",
): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/admin/api.php?action=${action}`;
}

export type SaveResponse = { ok: true } | { ok: false; error: string };
export type SimplyStatusResponse =
  | { ok: true; simplyAccount: string | null; apiKeyPresent: boolean }
  | { ok: false; error: string };

export type DockerEnvPublicResponse =
  | { ok: true; phpVersion: string }
  | { ok: false; error: string };

export type LocalStatus = {
  configPresent: boolean;
  configIsExample: boolean;
  adminBuilt: boolean;
  wpConfigPresent: boolean;
  wpInstalled: boolean;
  hasSyncedContent: boolean;
  hasSyncedPlugins: boolean;
  pluginCount: number;
  installedPlugins?: string[];
  needsSetup: boolean;
  setupPhase: "fresh" | "configured" | "installed-empty" | "ready";
  writable: { wpContent: boolean; plugins: boolean; upgrade: boolean };
  adminUrl: string;
  installUrl: string;
};

export type LocalStatusResponse = { ok: true } & LocalStatus | { ok: false; error: string };

export type TerminalRunnerSecretsResponse =
  | {
      ok: true;
      terminalAuth: string;
      runnerToken: string;
      runnerOrigin: string | null;
      terminalPort: number;
      runnerPort: number;
      syncRunnerPort: number;
    }
  | { ok: false; error: string; detail?: string };

/** User-facing message when terminal-runner-secrets cannot load (auth, stack, or API). */
export function formatTerminalRunnerSecretsError(
  res: Extract<TerminalRunnerSecretsResponse, { ok: false }>,
  options?: { prefix?: string },
): string {
  const prefix = options?.prefix ?? "Runner credentials are not initialized yet";
  const core = `${prefix} (${res.error}${res.detail ? `: ${res.detail}` : ""})`;
  if (res.error === "forbidden") {
    return `${core}. Click Unlock admin (top right) and paste WPDEV_ADMIN_SAVE_TOKEN from docker/.env once.`;
  }
  if (res.error === "not_found") {
    return `${core}. Rebuild admin: npm run admin:build:wp && npm run wp-dev -- down && npm run wp-dev -- up.`;
  }
  if (res.error === "token_not_configured") {
    return `${core}. Set WPDEV_ADMIN_SAVE_TOKEN in docker/.env and restart the stack.`;
  }
  if (res.error === "runner_secrets_unavailable") {
    return `${core}. Run npm run wp-dev -- up in this clone.`;
  }
  return `${core}. Run npm run wp-dev -- up in this clone.`;
}

let terminalRunnerPort = 7682;
let syncRunnerPort = 7683;

export async function loadWpDevConfig(): Promise<Record<string, unknown> | null> {
  const url = apiPhpUrl("load");
  const t0 = performance.now();
  logAdmin("info", "loadWpDevConfig: request started", url);
  try {
    const res = await fetch(url, { method: "GET", credentials: "same-origin" });
    const ms = Math.round(performance.now() - t0);
    if (res.status === 404) {
      logAdmin("info", "loadWpDevConfig: no file yet (404)", `${ms}ms`);
      return null;
    }
    let data: unknown;
    try {
      data = await res.json();
    } catch (e) {
      logAdmin("error", "loadWpDevConfig: response is not JSON", `${res.status} ${ms}ms`);
      return null;
    }
    if (!data || typeof data !== "object") {
      logAdmin("warn", "loadWpDevConfig: empty or non-object body", `${res.status} ${ms}ms`);
      return null;
    }
    const o = data as Record<string, unknown>;
    if (o.ok === false) {
      logAdmin("info", "loadWpDevConfig: API returned ok=false", String(o.error ?? ""));
      return null;
    }
    if (typeof o.project === "string") {
      logAdmin("info", "loadWpDevConfig: loaded config from server", `project=${o.project} ${ms}ms HTTP ${res.status}`);
      return o;
    }
    logAdmin("warn", "loadWpDevConfig: JSON missing project field", `${ms}ms`);
    return null;
  } catch (e) {
    logAdmin("error", "loadWpDevConfig: network or fetch failed", e instanceof Error ? e.message : String(e));
    return null;
  }
}

export async function loadLocalStatus(): Promise<LocalStatusResponse> {
  const url = apiPhpUrl("local-status");
  const t0 = performance.now();
  logAdmin("info", "loadLocalStatus: request started", url);
  try {
    const res = await fetch(url, { method: "GET", credentials: "same-origin" });
    const ms = Math.round(performance.now() - t0);
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      logAdmin("error", "loadLocalStatus: response is not JSON", `${res.status} ${ms}ms`);
      return { ok: false, error: "invalid_response" };
    }
    if (!res.ok || !data || typeof data !== "object" || (data as { ok?: boolean }).ok !== true) {
      const err =
        data && typeof data === "object" && "error" in data
          ? String((data as { error: unknown }).error)
          : `HTTP ${res.status}`;
      logAdmin("warn", "loadLocalStatus: failed", err);
      return { ok: false, error: err };
    }
    logAdmin("info", "loadLocalStatus: ok", `phase=${String((data as LocalStatus).setupPhase)} ${ms}ms`);
    return data as LocalStatusResponse;
  } catch (e) {
    logAdmin("error", "loadLocalStatus: network or fetch failed", e instanceof Error ? e.message : String(e));
    return { ok: false, error: "network_error" };
  }
}

export async function saveWpDevConfig(
  body: Record<string, unknown>,
  _legacyToken?: string,
): Promise<SaveResponse> {
  const t0 = performance.now();
  const project = typeof body.project === "string" ? body.project : "?";
  logAdmin("info", "saveWpDevConfig: POST started", `project=${project}`);
  const localCheck = validateWpDevConfigJson(body);
  if (!localCheck.ok) {
    logAdmin("warn", "saveWpDevConfig: blocked — schema validation failed", localCheck.errors);
    return { ok: false, error: `config_invalid: ${localCheck.errors}` };
  }
  const headers = buildAdminApiHeaders({ "Content-Type": "application/json" });
  try {
    const res = await fetch(apiPhpUrl("save"), {
      method: "POST",
      headers,
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
    const ms = Math.round(performance.now() - t0);
    let data: unknown;
    try {
      data = await res.json();
    } catch (e) {
      logAdmin("error", "saveWpDevConfig: response is not JSON", `HTTP ${res.status} ${ms}ms`);
      return { ok: false, error: "invalid_response" };
    }
    if (!res.ok) {
      if (data && typeof data === "object" && "error" in data) {
        const err = String((data as { error: unknown }).error);
        const detail =
          "detail" in data ? String((data as { detail: unknown }).detail) : "";
        const msg = detail ? `${err} (${detail})` : err;
        logAdmin("error", "saveWpDevConfig: save rejected", `HTTP ${res.status} ${msg} ${ms}ms`);
        return { ok: false, error: msg };
      }
      logAdmin("error", "saveWpDevConfig: HTTP error", `${res.status} ${ms}ms`);
      return { ok: false, error: `HTTP ${res.status}` };
    }
    logAdmin("info", "saveWpDevConfig: saved successfully", `HTTP ${res.status} ${ms}ms`);
    return data as SaveResponse;
  } catch (e) {
    logAdmin("error", "saveWpDevConfig: network or fetch failed", e instanceof Error ? e.message : String(e));
    return { ok: false, error: "network_error" };
  }
}

/** Upsert secrets into host `docker/.env` (not wp-dev.config.json). Same auth as save when token is set. */
export async function saveDockerEnvSecrets(
  body: Record<string, string>,
  _legacyToken?: string,
): Promise<SaveResponse> {
  const t0 = performance.now();
  logAdmin("info", "saveDockerEnvSecrets: POST started", `keys=${Object.keys(body).join(",")}`);
  const headers = buildAdminApiHeaders({ "Content-Type": "application/json" });
  try {
    const res = await fetch(apiPhpUrl("save-docker-env"), {
      method: "POST",
      headers,
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
    const ms = Math.round(performance.now() - t0);
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      logAdmin("error", "saveDockerEnvSecrets: response is not JSON", `HTTP ${res.status} ${ms}ms`);
      return { ok: false, error: "invalid_response" };
    }
    if (!res.ok) {
      if (data && typeof data === "object" && "error" in data) {
        const err = String((data as { error: unknown }).error);
        const detail =
          "detail" in data ? String((data as { detail: unknown }).detail) : "";
        const msg = detail ? `${err} (${detail})` : err;
        logAdmin("error", "saveDockerEnvSecrets: rejected", `HTTP ${res.status} ${msg} ${ms}ms`);
        return { ok: false, error: msg };
      }
      return { ok: false, error: `HTTP ${res.status}` };
    }
    logAdmin("info", "saveDockerEnvSecrets: ok", `${ms}ms`);
    return data as SaveResponse;
  } catch (e) {
    logAdmin("error", "saveDockerEnvSecrets: fetch failed", e instanceof Error ? e.message : String(e));
    return { ok: false, error: "network_error" };
  }
}

export async function loadSimplyStatus(): Promise<SimplyStatusResponse> {
  const t0 = performance.now();
  try {
    const res = await fetch(apiPhpUrl("simply-status"), {
      method: "GET",
      credentials: "same-origin",
    });
    const ms = Math.round(performance.now() - t0);
    const data = (await res.json()) as unknown;
    if (!res.ok || !data || typeof data !== "object") {
      logAdmin("warn", "loadSimplyStatus: unexpected response", `HTTP ${res.status} ${ms}ms`);
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const o = data as Record<string, unknown>;
    if (o.ok === true) {
      return {
        ok: true,
        simplyAccount: typeof o.simplyAccount === "string" ? o.simplyAccount : null,
        apiKeyPresent: Boolean(o.apiKeyPresent),
      };
    }
    return { ok: false, error: String(o.error ?? "unknown_error") };
  } catch (e) {
    logAdmin("warn", "loadSimplyStatus: fetch failed", e instanceof Error ? e.message : String(e));
    return { ok: false, error: "network_error" };
  }
}

export async function loadDockerEnvPublic(): Promise<DockerEnvPublicResponse> {
  try {
    const res = await fetch(apiPhpUrl("docker-env-public"), {
      method: "GET",
      credentials: "same-origin",
    });
    const data = (await res.json()) as unknown;
    if (!data || typeof data !== "object") {
      return { ok: false, error: "invalid_response" };
    }
    const o = data as Record<string, unknown>;
    if (res.ok && o.ok === true) {
      return { ok: true, phpVersion: String(o.phpVersion ?? "8.2") };
    }
    return { ok: false, error: String(o.error ?? `HTTP ${res.status}`) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network_error" };
  }
}

export async function loadTerminalRunnerSecrets(): Promise<TerminalRunnerSecretsResponse> {
  try {
    const res = await fetch(apiPhpUrl("terminal-runner-secrets"), {
      method: "GET",
      credentials: "same-origin",
      headers: buildAdminApiHeaders(),
    });
    const data = (await res.json()) as unknown;
    if (!data || typeof data !== "object") {
      return { ok: false, error: "invalid_response" };
    }
    const o = data as Record<string, unknown>;
    if (res.ok && o.ok === true) {
      const parsedTerminalPort = Number(o.terminalPort ?? 7681);
      const parsedRunnerPort = Number(o.runnerPort ?? 7682);
      const parsedSyncRunnerPort = Number(o.syncRunnerPort ?? 7683);
      terminalRunnerPort =
        Number.isFinite(parsedRunnerPort) && parsedRunnerPort > 0 ? parsedRunnerPort : 7682;
      syncRunnerPort =
        Number.isFinite(parsedSyncRunnerPort) && parsedSyncRunnerPort > 0
          ? parsedSyncRunnerPort
          : 7683;
      return {
        ok: true,
        terminalAuth: String(o.terminalAuth ?? ""),
        runnerToken: String(o.runnerToken ?? ""),
        runnerOrigin: typeof o.runnerOrigin === "string" ? o.runnerOrigin : null,
        terminalPort:
          Number.isFinite(parsedTerminalPort) && parsedTerminalPort > 0 ? parsedTerminalPort : 7681,
        runnerPort: terminalRunnerPort,
        syncRunnerPort,
      };
    }
    return {
      ok: false,
      error: String(o.error ?? `HTTP ${res.status}`),
      detail: typeof o.detail === "string" ? o.detail : undefined,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network_error" };
  }
}

export type StagingDbSecretsResponse =
  | { ok: true; host: string; name: string; user: string; password: string; prefix: string }
  | { ok: false; error: string; detail?: string };

export async function loadStagingDbSecrets(): Promise<StagingDbSecretsResponse> {
  try {
    const res = await fetch(apiPhpUrl("staging-db-secrets"), {
      method: "GET",
      credentials: "same-origin",
      headers: buildAdminApiHeaders(),
    });
    const data = (await res.json()) as unknown;
    if (!data || typeof data !== "object") {
      return { ok: false, error: `HTTP ${res.status}` };
    }
    const o = data as Record<string, unknown>;
    if (!res.ok || o.ok !== true) {
      return {
        ok: false,
        error: String(o.error ?? `HTTP ${res.status}`),
        detail: typeof o.detail === "string" ? o.detail : undefined,
      };
    }
    return {
      ok: true,
      host: String(o.host ?? ""),
      name: String(o.name ?? ""),
      user: String(o.user ?? ""),
      password: String(o.password ?? ""),
      prefix: String(o.prefix ?? ""),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network_error" };
  }
}

export type SimplyTestResponse =
  | { ok: true; status: number }
  | { ok: false; error: string; detail?: string; status?: number };

export async function verifySimplyApi(
  payload?: { account?: string; apiKey?: string },
): Promise<SimplyTestResponse> {
  const t0 = performance.now();
  try {
    const res = await fetch(apiPhpUrl("simply-test"), {
      method: "POST",
      headers: buildAdminApiHeaders({ "Content-Type": "application/json" }),
      credentials: "same-origin",
      body: JSON.stringify(payload ?? {}),
    });
    const ms = Math.round(performance.now() - t0);
    const data = (await res.json()) as unknown;
    if (!data || typeof data !== "object") {
      return { ok: false, error: "invalid_response" };
    }
    const o = data as Record<string, unknown>;
    if (res.ok && o.ok === true) {
      logAdmin("info", "verifySimplyApi: ok", `HTTP ${res.status} ${ms}ms`);
      return { ok: true, status: Number(o.status ?? res.status) };
    }
    const out: SimplyTestResponse = {
      ok: false,
      error: String(o.error ?? `HTTP ${res.status}`),
      detail: typeof o.detail === "string" ? o.detail : undefined,
      status: typeof o.status === "number" ? o.status : res.status,
    };
    logAdmin("warn", "verifySimplyApi: failed", `${out.error} ${ms}ms`);
    return out;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network_error" };
  }
}

export type StagingHttpsCheckResponse =
  | {
      ok: true;
      url: string;
      https: { ok: boolean; status: number; location?: string | null; preview?: string };
      http: { status: number; location?: string | null; redirectsToHttps: boolean };
    }
  | { ok: false; error: string; detail?: string };

export async function checkStagingHttps(payload?: {
  url?: string;
}): Promise<StagingHttpsCheckResponse> {
  try {
    const res = await fetch(apiPhpUrl("staging-https-check"), {
      method: "POST",
      headers: buildAdminApiHeaders({ "Content-Type": "application/json" }),
      credentials: "same-origin",
      body: JSON.stringify(payload ?? {}),
    });
    const data = (await res.json()) as unknown;
    if (!data || typeof data !== "object") {
      return { ok: false, error: "invalid_response" };
    }
    const o = data as Record<string, unknown>;
    if (res.ok && o.ok === true) {
      return {
        ok: true,
        url: String(o.url ?? ""),
        https: {
          ok: Boolean((o.https as Record<string, unknown> | undefined)?.ok),
          status: Number((o.https as Record<string, unknown> | undefined)?.status ?? 0),
          location: ((o.https as Record<string, unknown> | undefined)?.location as string | null) ?? null,
          preview: ((o.https as Record<string, unknown> | undefined)?.preview as string | undefined) ?? undefined,
        },
        http: {
          status: Number((o.http as Record<string, unknown> | undefined)?.status ?? 0),
          location: ((o.http as Record<string, unknown> | undefined)?.location as string | null) ?? null,
          redirectsToHttps: Boolean(
            (o.http as Record<string, unknown> | undefined)?.redirectsToHttps,
          ),
        },
      };
    }
    return {
      ok: false,
      error: String(o.error ?? `HTTP ${res.status}`),
      detail: typeof o.detail === "string" ? o.detail : undefined,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network_error" };
  }
}

export type StagingDbCheckResponse =
  | { ok: true; message: string; server?: string; database?: string }
  | { ok: false; error: string; detail?: string };

export async function checkStagingDbConnection(payload: {
  host?: string;
  port?: number;
  name?: string;
  user?: string;
  password?: string;
}): Promise<StagingDbCheckResponse> {
  try {
    const res = await fetch(apiPhpUrl("staging-db-check"), {
      method: "POST",
      headers: buildAdminApiHeaders({ "Content-Type": "application/json" }),
      credentials: "same-origin",
      body: JSON.stringify(payload ?? {}),
    });
    const raw = await res.text();
    let data: unknown = null;
    try {
      data = raw ? (JSON.parse(raw) as unknown) : null;
    } catch {
      return {
        ok: false,
        error: `HTTP ${res.status}`,
        detail: raw ? raw.slice(0, 240) : "non_json_response",
      };
    }
    if (!data || typeof data !== "object") {
      return { ok: false, error: "invalid_response", detail: `HTTP ${res.status}` };
    }
    const o = data as Record<string, unknown>;
    if (res.ok && o.ok === true) {
      return {
        ok: true,
        message: String(o.message ?? "Connection OK"),
        server: typeof o.server === "string" ? o.server : undefined,
        database: typeof o.database === "string" ? o.database : undefined,
      };
    }
    return {
      ok: false,
      error: String(o.error ?? `HTTP ${res.status}`),
      detail: typeof o.detail === "string" ? o.detail : undefined,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network_error" };
  }
}

export type StagingDomainCheckResponse =
  | {
      ok: true;
      url: string;
      host: string;
      dns: { ok: boolean; records: string[] };
      https: { ok: boolean; status: number; location?: string | null };
      http: { status: number; location?: string | null; redirectsToHttps: boolean };
      finalHostMatches: boolean;
      hints: string[];
    }
  | { ok: false; error: string; detail?: string };

export async function checkStagingDomain(payload?: {
  url?: string;
}): Promise<StagingDomainCheckResponse> {
  try {
    const res = await fetch(apiPhpUrl("staging-domain-check"), {
      method: "POST",
      headers: buildAdminApiHeaders({ "Content-Type": "application/json" }),
      credentials: "same-origin",
      body: JSON.stringify(payload ?? {}),
    });
    const data = (await res.json()) as unknown;
    if (!data || typeof data !== "object") {
      return { ok: false, error: "invalid_response" };
    }
    const o = data as Record<string, unknown>;
    if (res.ok && o.ok === true) {
      const dnsObj = (o.dns as Record<string, unknown> | undefined) ?? {};
      const httpsObj = (o.https as Record<string, unknown> | undefined) ?? {};
      const httpObj = (o.http as Record<string, unknown> | undefined) ?? {};
      return {
        ok: true,
        url: String(o.url ?? ""),
        host: String(o.host ?? ""),
        dns: {
          ok: Boolean(dnsObj.ok),
          records: Array.isArray(dnsObj.records) ? dnsObj.records.map((x) => String(x)) : [],
        },
        https: {
          ok: Boolean(httpsObj.ok),
          status: Number(httpsObj.status ?? 0),
          location: (httpsObj.location as string | null | undefined) ?? null,
        },
        http: {
          status: Number(httpObj.status ?? 0),
          location: (httpObj.location as string | null | undefined) ?? null,
          redirectsToHttps: Boolean(httpObj.redirectsToHttps),
        },
        finalHostMatches: Boolean(o.finalHostMatches),
        hints: Array.isArray(o.hints) ? o.hints.map((x) => String(x)) : [],
      };
    }
    return {
      ok: false,
      error: String(o.error ?? `HTTP ${res.status}`),
      detail: typeof o.detail === "string" ? o.detail : undefined,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network_error" };
  }
}

/** ttyd on loopback is always plain HTTP, regardless of admin page protocol. */
export function buildTerminalEmbedUrl(terminalPort: number, terminalAuth?: string): string {
  const port = Number.isFinite(terminalPort) && terminalPort > 0 ? terminalPort : 7681;
  const auth = terminalAuth?.trim();
  if (!auth || !auth.includes(":")) {
    return `http://127.0.0.1:${port}/`;
  }
  const colon = auth.indexOf(":");
  const user = auth.slice(0, colon);
  const pass = auth.slice(colon + 1);
  return `http://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@127.0.0.1:${port}/`;
}

export function terminalIframeBlockedByHttpsAdmin(): boolean {
  return typeof window !== "undefined" && window.location.protocol === "https:";
}

function terminalRunnerBaseUrl(kind: "terminal" | "sync" = "terminal"): string {
  const port = kind === "sync" ? syncRunnerPort : terminalRunnerPort;
  return `http://127.0.0.1:${port}`;
}

function basicAuthHeader(auth: string): string {
  return `Basic ${btoa(auth)}`;
}

function runnerSecurityHeaders(auth: string, token: string): Record<string, string> {
  const trimmed = token.trim();
  if (!trimmed) return {};
  return {
    Authorization: basicAuthHeader(auth),
    "X-WP-DEV-Terminal-Token": trimmed,
  };
}

export type TerminalAction =
  | "generate_keypair"
  | "ssh_test"
  | "wpdev_doctor"
  | "wpdev_pull"
  | "wpdev_pull_dry"
  | "wpdev_push"
  | "wpdev_push_dry"
  | "wpdev_sync_preview"
  | "wpdev_sync_scan"
  | "wpdev_update"
  | "wpdev_update_preflight"
  | "backup_create"
  | "backup_list"
  | "restore_env"
  | "git_status"
  | "git_log"
  | "git_show"
  | "git_rollback_branch"
  | "git_reset_hard";

export type TerminalRunResponse =
  | { ok: true; jobId: string; command: string }
  | { ok: false; error: string };

export type TerminalJobStatus =
  | { ok: true; status: "running" | "done"; output: string; exitCode: number | null; command: string }
  | { ok: false; error: string };

export async function fetchRunnerHealth(): Promise<
  | { ok: true; terminal: boolean; sync: boolean }
  | { ok: false; error: string }
> {
  try {
    const res = await fetch(apiPhpUrl("runner-health"), {
      method: "GET",
      credentials: "same-origin",
      headers: buildAdminApiHeaders(),
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok || data.ok !== true) {
      return { ok: false, error: String(data.error ?? `HTTP ${res.status}`) };
    }
    return {
      ok: true,
      terminal: Boolean(data.terminal),
      sync: Boolean(data.sync),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network_error" };
  }
}

export async function runTerminalAction(
  action: TerminalAction,
  args?: Record<string, string>,
  runnerKind: "terminal" | "sync" = "terminal",
): Promise<TerminalRunResponse> {
  try {
    const res = await fetch(apiPhpUrl("runner-run"), {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        ...buildAdminApiHeaders(),
      },
      body: JSON.stringify({ kind: runnerKind, action, args: args ?? {} }),
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok || data.ok !== true) {
      const detail = typeof data.detail === "string" ? data.detail : "";
      const err = String(data.error ?? `HTTP ${res.status}`);
      return { ok: false, error: detail ? `${err}: ${detail}` : err };
    }
    return {
      ok: true,
      jobId: String(data.jobId ?? ""),
      command: String(data.command ?? ""),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network_error" };
  }
}

export async function getTerminalJobStatus(
  jobId: string,
  runnerKind: "terminal" | "sync" = "terminal",
): Promise<TerminalJobStatus> {
  try {
    const res = await fetch(
      `${apiPhpUrl("runner-status")}&jobId=${encodeURIComponent(jobId)}&kind=${encodeURIComponent(runnerKind)}`,
      {
        method: "GET",
        credentials: "same-origin",
        headers: buildAdminApiHeaders(),
      },
    );
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok || data.ok !== true) {
      const detail = typeof data.detail === "string" ? data.detail : "";
      const err = String(data.error ?? `HTTP ${res.status}`);
      return { ok: false, error: detail ? `${err}: ${detail}` : err };
    }
    return {
      ok: true,
      status: (data.status as "running" | "done") ?? "running",
      output: String(data.output ?? ""),
      exitCode: typeof data.exitCode === "number" ? data.exitCode : null,
      command: String(data.command ?? ""),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network_error" };
  }
}

/** Generate a URL-safe token for local secrets. */
export function generateRunnerToken(bytes = 24): string {
  const size = Number.isFinite(bytes) && bytes >= 12 ? Math.floor(bytes) : 24;
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
  const out: string[] = [];
  const cryptoApi =
    typeof window !== "undefined" ? window.crypto : (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoApi?.getRandomValues) {
    const data = new Uint8Array(size);
    cryptoApi.getRandomValues(data);
    for (let i = 0; i < data.length; i += 1) out.push(chars[data[i] % chars.length]);
    return out.join("");
  }
  for (let i = 0; i < size; i += 1) {
    out.push(chars[Math.floor(Math.random() * chars.length)]);
  }
  return out.join("");
}

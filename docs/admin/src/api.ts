import { logAdmin } from "./adminLog";
import { validateWpDevConfigJson } from "./validateConfig";

/** Same-origin /admin/api.php (Docker) or dev proxy to WP port. */
export function apiPhpUrl(
  action:
    | "load"
    | "save"
    | "save-docker-env"
    | "simply-status"
    | "simply-test"
    | "simply-setup-staging",
): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/admin/api.php?action=${action}`;
}

export type SaveResponse = { ok: true } | { ok: false; error: string };
export type SimplyStatusResponse =
  | { ok: true; simplyAccount: string | null; apiKeyPresent: boolean }
  | { ok: false; error: string };

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

export async function saveWpDevConfig(
  body: Record<string, unknown>,
  token?: string,
): Promise<SaveResponse> {
  const t0 = performance.now();
  const project = typeof body.project === "string" ? body.project : "?";
  logAdmin("info", "saveWpDevConfig: POST started", `project=${project} token=${token?.trim() ? "yes" : "no"}`);
  const localCheck = validateWpDevConfigJson(body);
  if (!localCheck.ok) {
    logAdmin("warn", "saveWpDevConfig: blocked — schema validation failed", localCheck.errors);
    return { ok: false, error: `config_invalid: ${localCheck.errors}` };
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token?.trim()) headers["X-WP-DEV-Admin-Token"] = token.trim();
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
  token?: string,
): Promise<SaveResponse> {
  const t0 = performance.now();
  logAdmin("info", "saveDockerEnvSecrets: POST started", `keys=${Object.keys(body).join(",")}`);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token?.trim()) headers["X-WP-DEV-Admin-Token"] = token.trim();
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
      headers: { "Content-Type": "application/json" },
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

export type SimplySetupStagingResponse =
  | { ok: true; lines: string[]; staging?: { host?: string; path?: string; url?: string; user?: string } }
  | { ok: false; error: string; detail?: string };

export async function setupSimplyStagingFromUi(payload: {
  account?: string;
  apiKey?: string;
  apex?: string;
  stagingLabel?: string;
  keepExistingDns?: boolean;
}): Promise<SimplySetupStagingResponse> {
  try {
    const res = await fetch(apiPhpUrl("simply-setup-staging"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as unknown;
    if (!data || typeof data !== "object") {
      return { ok: false, error: "invalid_response" };
    }
    const o = data as Record<string, unknown>;
    if (res.ok && o.ok === true) {
      return {
        ok: true,
        lines: Array.isArray(o.lines) ? o.lines.map((x) => String(x)) : [],
        staging:
          o.staging && typeof o.staging === "object"
            ? (o.staging as { host?: string; path?: string; url?: string; user?: string })
            : undefined,
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

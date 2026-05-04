import { logAdmin } from "./adminLog";
import { validateWpDevConfigJson } from "./validateConfig";

/** Same-origin /admin/api.php (Docker) or dev proxy to WP port. */
export function apiPhpUrl(action: "load" | "save"): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/admin/api.php?action=${action}`;
}

export type SaveResponse = { ok: true } | { ok: false; error: string };

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

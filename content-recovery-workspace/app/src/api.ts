import type { ContentListItem, ContentObject, ProjectStats } from "./types";

export const IMPORT_TOKEN_LS_KEY = "wpdev-import-token";

export function readToken(): string {
  try {
    return localStorage.getItem(IMPORT_TOKEN_LS_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeToken(value: string): void {
  try {
    const t = value.trim();
    if (t) localStorage.setItem(IMPORT_TOKEN_LS_KEY, t);
    else localStorage.removeItem(IMPORT_TOKEN_LS_KEY);
  } catch {
    /* ignore */
  }
}

function apiUrl(path: string, params?: Record<string, string>): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const qs = params ? `&${new URLSearchParams(params).toString()}` : "";
  return `${origin}/import/api/index.php?path=${encodeURIComponent(path)}${qs}`;
}

async function request<T>(
  path: string,
  init?: RequestInit & { params?: Record<string, string> },
): Promise<T> {
  const token = readToken();
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(init?.headers ?? {}),
  };
  if (token) {
    (headers as Record<string, string>)["X-WP-Dev-Import-Token"] = token;
  }

  const res = await fetch(apiUrl(path, init?.params), {
    ...init,
    headers,
  });
  const data = (await res.json()) as T & {
    ok?: boolean;
    error?: string;
    validation?: { errors?: Array<{ message: string }> };
  };
  if (!res.ok) {
    const validationErrors = data.validation?.errors?.map((e) => e.message) ?? [];
    if (validationErrors.length > 0) {
      throw new Error(validationErrors.slice(0, 5).join(" · "));
    }
    throw new Error(data.error ?? `HTTP ${res.status}`);
  }
  return data;
}

export async function healthCheck(): Promise<{
  ok: boolean;
  project: string;
  client_mode?: boolean;
  requires_token?: boolean;
}> {
  return request("health");
}

export async function fetchStats(): Promise<ProjectStats> {
  return request("stats");
}

export async function fetchObjects(params: {
  type?: string;
  status?: string;
  search?: string;
}): Promise<{ ok: boolean; objects: ContentListItem[] }> {
  const p: Record<string, string> = {};
  if (params.type) p.type = params.type;
  if (params.status) p.status = params.status;
  if (params.search) p.search = params.search;
  return request("objects", { params: p });
}

export async function fetchObject(id: string): Promise<{ ok: boolean; object: ContentObject }> {
  return request(`object/${id}`);
}

export async function patchObject(
  id: string,
  patch: Record<string, unknown>,
): Promise<{ ok: boolean; object: ContentObject }> {
  return request(`object/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function ingestKnowledgeBase(): Promise<{
  ok: boolean;
  stats: Record<string, number>;
}> {
  return request("import/knowledge-base", { method: "POST", body: "{}" });
}

export async function validateProject(): Promise<{
  ok: boolean;
  report: {
    ok: boolean;
    errors: { code: string; message: string }[];
    warnings: { code: string; message: string }[];
    compatibility_avg: number;
    object_count: number;
  };
}> {
  return request("validate");
}

export async function exportProject(format = "all"): Promise<{
  ok: boolean;
  export?: { directory: string; files: string[] };
  validation?: unknown;
}> {
  return request("export", {
    method: "POST",
    body: JSON.stringify({ format }),
  });
}

export async function searchObjects(q: string): Promise<{ ok: boolean; results: ContentListItem[] }> {
  return request("search", { params: { q } });
}

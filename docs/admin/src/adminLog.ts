export type AdminLogLevel = "info" | "warn" | "error";

export type AdminLogEntry = {
  ts: string;
  level: AdminLogLevel;
  message: string;
  detail?: string;
};

const MAX = 300;
const entries: AdminLogEntry[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

/** Ring-buffer log + console mirror (F12 → Console). */
export function logAdmin(level: AdminLogLevel, message: string, detail?: string): void {
  const ts = new Date().toISOString();
  entries.push({ ts, level, message, detail });
  while (entries.length > MAX) entries.shift();
  const line = `[${ts}] [${level}] ${message}${detail ? ` | ${detail}` : ""}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
  emit();
}

export function subscribeAdminLog(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function getAdminLogSnapshot(): AdminLogEntry[] {
  return [...entries];
}

export function clearAdminLog(): void {
  entries.length = 0;
  emit();
}

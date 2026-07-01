const PASSTHROUGH_ENV_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "USERNAME",
  "LOGNAME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TMPDIR",
  "TEMP",
  "TMP",
  "SystemRoot",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "ComSpec",
  "PATHEXT",
  "TERM",
  "DOCKER_HOST",
  "WSL_DISTRO_NAME",
  "WSLENV",
] as const;

/** Minimal parent env for child processes (avoids leaking unrelated secrets). */
export function pickChildEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...extra };
  for (const key of PASSTHROUGH_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined && env[key] === undefined) {
      env[key] = value;
    }
  }
  return env;
}

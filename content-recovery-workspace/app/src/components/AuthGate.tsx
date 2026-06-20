import { useEffect, useState } from "react";
import { healthCheck, readToken, writeToken } from "../api";

type Props = {
  children: React.ReactNode;
  onReady: (clientMode: boolean) => void;
};

export function AuthGate({ children, onReady }: Props) {
  const [token, setToken] = useState(readToken());
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [needsTokenForm, setNeedsTokenForm] = useState(false);

  async function connect(withToken = token) {
    setChecking(true);
    setError("");
    writeToken(withToken);
    try {
      const health = await healthCheck();
      setAuthed(true);
      onReady(health.client_mode ?? false);
    } catch (e) {
      setAuthed(false);
      setNeedsTokenForm(true);
      setError(e instanceof Error ? e.message : "Connection failed");
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    void connect(readToken());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (checking && !authed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6 dark:bg-slate-900">
        <p className="text-sm text-slate-600 dark:text-slate-300">Loading workspace…</p>
      </div>
    );
  }

  if (authed) {
    return <>{children}</>;
  }

  if (!needsTokenForm) {
    return null;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6 dark:bg-slate-900">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-white">Content Recovery Workspace</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Developer access only: enter the API token from server configuration.
        </p>
        <label className="mt-4 block text-sm font-medium text-slate-700 dark:text-slate-200">
          API token
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </label>
        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
        <button
          type="button"
          onClick={() => void connect(token)}
          disabled={checking}
          className="mt-4 w-full rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {checking ? "Connecting…" : "Continue"}
        </button>
      </div>
    </div>
  );
}

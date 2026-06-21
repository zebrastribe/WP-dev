import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  bootstrapLocalAdminSession,
  fetchAdminAuthStatus,
  logoutAdminSession,
  readStoredAdminSaveToken,
  unlockAdminSession,
  writeStoredAdminSaveToken,
} from "./api";
import { logAdmin } from "./adminLog";

type AdminAuthContextValue = {
  loading: boolean;
  tokenConfigured: boolean;
  authenticated: boolean;
  authVersion: number;
  unlock: (token: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  logout: () => Promise<void>;
  requestUnlock: () => void;
  showUnlockModal: boolean;
  closeUnlockModal: () => void;
};

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

async function tryAutoUnlock(): Promise<boolean> {
  const boot = await bootstrapLocalAdminSession();
  if (boot.ok) return true;

  const legacy = readStoredAdminSaveToken();
  if (legacy.trim()) {
    const unlocked = await unlockAdminSession(legacy.trim());
    if (unlocked.ok) {
      writeStoredAdminSaveToken("");
      logAdmin("info", "AdminAuth: migrated legacy localStorage token to session");
      return true;
    }
  }
  return false;
}

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [tokenConfigured, setTokenConfigured] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [authVersion, setAuthVersion] = useState(0);
  const [showUnlockModal, setShowUnlockModal] = useState(false);
  const [unlockToken, setUnlockToken] = useState("");
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);

  const refreshAuth = useCallback(async () => {
    const status = await fetchAdminAuthStatus();
    if (status.ok) {
      setTokenConfigured(status.tokenConfigured);
      setAuthenticated(status.authenticated);
      if (status.authenticated) {
        setAuthVersion((v) => v + 1);
      }
    } else {
      setTokenConfigured(true);
      setAuthenticated(false);
    }
    return status;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let status = await refreshAuth();
      if (cancelled) return;

      if (status.ok && !status.authenticated) {
        const autoOk = await tryAutoUnlock();
        if (cancelled) return;
        if (autoOk) {
          setAuthenticated(true);
          setAuthVersion((v) => v + 1);
          status = await refreshAuth();
        }
      }

      if (!cancelled) {
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshAuth]);

  const unlock = useCallback(async (token: string) => {
    const res = await unlockAdminSession(token);
    if (res.ok) {
      setAuthenticated(true);
      setAuthVersion((v) => v + 1);
      setShowUnlockModal(false);
      setUnlockError(null);
      setUnlockToken("");
      writeStoredAdminSaveToken("");
      return { ok: true as const };
    }
    return { ok: false as const, error: res.error };
  }, []);

  const logout = useCallback(async () => {
    await logoutAdminSession();
    setAuthenticated(false);
    setAuthVersion((v) => v + 1);
    const autoOk = await tryAutoUnlock();
    if (autoOk) {
      setAuthenticated(true);
      setAuthVersion((v) => v + 1);
      setShowUnlockModal(false);
    } else {
      setShowUnlockModal(true);
    }
  }, []);

  const requestUnlock = useCallback(() => {
    void (async () => {
      const autoOk = await tryAutoUnlock();
      if (autoOk) {
        setAuthenticated(true);
        setAuthVersion((v) => v + 1);
        setShowUnlockModal(false);
        setUnlockError(null);
        return;
      }
      setUnlockError(null);
      setShowUnlockModal(true);
    })();
  }, []);

  const closeUnlockModal = useCallback(() => {
    if (authenticated) {
      setShowUnlockModal(false);
      setUnlockError(null);
    }
  }, [authenticated]);

  const value = useMemo(
    () => ({
      loading,
      tokenConfigured,
      authenticated,
      authVersion,
      unlock,
      logout,
      requestUnlock,
      showUnlockModal,
      closeUnlockModal,
    }),
    [
      loading,
      tokenConfigured,
      authenticated,
      authVersion,
      unlock,
      logout,
      requestUnlock,
      showUnlockModal,
      closeUnlockModal,
    ],
  );

  return (
    <AdminAuthContext.Provider value={value}>
      {children}
      {showUnlockModal && !loading && !authenticated ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-unlock-title"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <h2 id="admin-unlock-title" className="text-lg font-semibold text-slate-900 dark:text-white">
              Unlock wp-dev admin
            </h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              Auto-unlock failed (not localhost or token missing). Paste{" "}
              <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">WPDEV_ADMIN_SAVE_TOKEN</code> from{" "}
              <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">docker/.env</code>, or run{" "}
              <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">wp-dev up</code>.
            </p>
            <label className="mt-4 block">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Admin token</span>
              <input
                type="password"
                autoComplete="off"
                autoFocus
                value={unlockToken}
                onChange={(e) => setUnlockToken(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && unlockToken.trim() && !unlockBusy) {
                    void (async () => {
                      setUnlockBusy(true);
                      setUnlockError(null);
                      const res = await unlock(unlockToken.trim());
                      if (!res.ok) setUnlockError(res.error);
                      setUnlockBusy(false);
                    })();
                  }
                }}
                className="mt-1 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-950"
                placeholder="From docker/.env"
              />
            </label>
            {unlockError ? (
              <p className="mt-2 text-sm text-red-600 dark:text-red-400">{unlockError}</p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={unlockBusy || !unlockToken.trim()}
                onClick={() => {
                  void (async () => {
                    setUnlockBusy(true);
                    setUnlockError(null);
                    const res = await unlock(unlockToken.trim());
                    if (!res.ok) setUnlockError(res.error);
                    setUnlockBusy(false);
                  })();
                }}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {unlockBusy ? "Unlocking…" : "Unlock"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth(): AdminAuthContextValue {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) {
    throw new Error("useAdminAuth must be used within AdminAuthProvider");
  }
  return ctx;
}

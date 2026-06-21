import { useAdminAuth } from "./AdminAuthProvider";

export function AdminAuthBar() {
  const { loading, tokenConfigured, authenticated, logout, requestUnlock } = useAdminAuth();

  if (loading) {
    return (
      <span className="text-xs text-slate-500 dark:text-slate-400">Checking admin session…</span>
    );
  }

  if (!tokenConfigured) {
    return (
      <span className="text-xs text-amber-700 dark:text-amber-300">
        Set <code className="rounded bg-amber-100/80 px-1 dark:bg-amber-900/50">WPDEV_ADMIN_SAVE_TOKEN</code> in{" "}
        docker/.env and restart the stack.
      </span>
    );
  }

  if (authenticated) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-emerald-700 dark:text-emerald-300">Admin unlocked</span>
        <button
          type="button"
          onClick={() => void logout()}
          className="rounded border border-slate-300 px-2 py-0.5 text-xs dark:border-slate-600"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={requestUnlock}
      className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white"
    >
      Unlock admin
    </button>
  );
}

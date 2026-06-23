import { useCallback, useEffect, useState } from "react";
import { apiPhpUrl } from "./api";
import { buildAdminApiHeaders } from "./adminAuthState";

type ManagedService = {
  name: string;
  kind: string;
  status: string;
  health: string;
  port?: number;
  restartCount: number;
  lastHeartbeat: string;
};

type Registry = {
  projectId: string;
  supervisorPid: number;
  supervisorPort: number;
  shutdownPhase: string;
  ports: Record<string, number>;
  services: ManagedService[];
};

export function ServicesTab() {
  const [registry, setRegistry] = useState<Registry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(apiPhpUrl("services"), {
        credentials: "same-origin",
        headers: buildAdminApiHeaders(),
      });
      const data = (await res.json()) as { ok?: boolean; registry?: Registry | null; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        setRegistry(null);
        return;
      }
      setRegistry(data.registry ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load services");
      setRegistry(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Service Manager</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Managed processes, ports, and health from <code>logs/service-registry.json</code>.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Refresh
        </button>
      </div>

      {loading && <p className="text-sm text-slate-500">Loading…</p>}
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {!loading && !registry && !error && (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          No registry yet. Run <code>npm run wp-dev -- up</code> to start the stack.
        </p>
      )}

      {registry && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <div className="text-xs uppercase text-slate-500">Supervisor</div>
              <div className="font-mono text-sm">PID {registry.supervisorPid}</div>
              <div className="font-mono text-sm">:{registry.supervisorPort}</div>
            </div>
            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <div className="text-xs uppercase text-slate-500">Shutdown phase</div>
              <div className="font-mono text-sm">{registry.shutdownPhase}</div>
            </div>
            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <div className="text-xs uppercase text-slate-500">Reserved ports</div>
              <div className="font-mono text-xs">
                {Object.entries(registry.ports)
                  .map(([k, v]) => `${k}=${v}`)
                  .join(" ")}
              </div>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800">
                <tr>
                  <th className="px-3 py-2 font-medium">Service</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Health</th>
                  <th className="px-3 py-2 font-medium">Port</th>
                  <th className="px-3 py-2 font-medium">Restarts</th>
                </tr>
              </thead>
              <tbody>
                {registry.services.map((s) => (
                  <tr key={s.name} className="border-t border-slate-200 dark:border-slate-700">
                    <td className="px-3 py-2 font-mono">{s.name}</td>
                    <td className="px-3 py-2">{s.status}</td>
                    <td className="px-3 py-2">{s.health}</td>
                    <td className="px-3 py-2 font-mono">{s.port ?? "—"}</td>
                    <td className="px-3 py-2">{s.restartCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-slate-500">
            CLI: <code>npm run wp-dev -- services</code> ·{" "}
            <code>npm run wp-dev -- doctor --filesystem</code> ·{" "}
            <code>npm run wp-dev -- doctor --lifecycle</code>
          </p>
        </>
      )}
    </div>
  );
}

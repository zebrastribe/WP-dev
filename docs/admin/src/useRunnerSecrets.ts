import { useEffect, useMemo, useState } from "react";
import {
  fetchRunnerHealth,
  formatTerminalRunnerSecretsError,
  loadTerminalRunnerSecrets,
} from "./api";
import { useAdminAuth } from "./AdminAuthProvider";

export function useRunnerSecrets(prefix = "Runner credentials are not initialized yet") {
  const { authenticated, authVersion, requestUnlock } = useAdminAuth();
  const [terminalAuth, setTerminalAuth] = useState("");
  const [runnerToken, setRunnerToken] = useState("");
  const [terminalPort, setTerminalPort] = useState(7681);
  const [runnerReady, setRunnerReady] = useState(false);
  const [runnerMessage, setRunnerMessage] = useState("");

  const canRun = useMemo(() => runnerReady && authenticated, [runnerReady, authenticated]);

  useEffect(() => {
    let cancelled = false;
    if (!authenticated) {
      setRunnerReady(false);
      setRunnerMessage("Unlock admin to load runner credentials.");
      return () => {
        cancelled = true;
      };
    }
    void (async () => {
      const secrets = await loadTerminalRunnerSecrets();
      if (cancelled) return;
      if (!secrets.ok) {
        setRunnerReady(false);
        setRunnerMessage(formatTerminalRunnerSecretsError(secrets, { prefix }));
        if (secrets.error === "forbidden") {
          requestUnlock();
        }
        return;
      }
      setTerminalAuth(secrets.terminalAuth);
      setRunnerToken(secrets.runnerToken);
      setTerminalPort(secrets.terminalPort);

      const health = await fetchRunnerHealth();
      if (cancelled) return;
      if (!health.ok) {
        setRunnerReady(false);
        setRunnerMessage(`Runner health check failed: ${health.error}`);
        return;
      }
      if (!health.terminal || !health.sync) {
        setRunnerReady(false);
        const parts: string[] = [];
        if (!health.terminal) parts.push("terminal runner");
        if (!health.sync) parts.push("host runner");
        setRunnerMessage(`Unreachable: ${parts.join(", ")}. Run: npm run wp-dev -- up`);
        return;
      }
      setRunnerReady(true);
      setRunnerMessage("Runners ready (proxied via admin API).");
    })();
    return () => {
      cancelled = true;
    };
  }, [authenticated, authVersion, prefix, requestUnlock]);

  return {
    terminalAuth,
    runnerToken,
    terminalPort,
    runnerReady,
    runnerMessage,
    canRun,
  };
}

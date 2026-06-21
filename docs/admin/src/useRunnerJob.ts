import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelTerminalJob,
  getTerminalJobStatus,
  runTerminalAction,
  type TerminalAction,
} from "./api";

export type RunnerJobPhase = "idle" | "running" | "success" | "error" | "cancelled";

export type RunnerJobState = {
  phase: RunnerJobPhase;
  output: string;
  exitCode: number | null;
  error: string | null;
  label: string;
  startedAt: number | null;
};

const idleJob: RunnerJobState = {
  phase: "idle",
  output: "",
  exitCode: null,
  error: null,
  label: "",
  startedAt: null,
};

export function useRunnerJob(runnerKind: "sync" | "terminal", canRun: boolean) {
  const [job, setJob] = useState<RunnerJobState>(idleJob);
  const outputRef = useRef<HTMLPreElement>(null);
  const activeJobIdRef = useRef<string | null>(null);
  const abortRef = useRef(false);

  useEffect(() => {
    const el = outputRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [job.output]);

  const reset = useCallback(() => {
    activeJobIdRef.current = null;
    abortRef.current = false;
    setJob(idleJob);
  }, []);

  const cancel = useCallback(async () => {
    const jobId = activeJobIdRef.current;
    if (!jobId || abortRef.current) return;
    abortRef.current = true;
    const res = await cancelTerminalJob(jobId, runnerKind);
    const st = await getTerminalJobStatus(jobId, runnerKind);
    const output = st.ok ? st.output : res.ok ? "" : res.error;
    setJob((prev) => ({
      ...prev,
      phase: "cancelled",
      output: output || prev.output || "Cancelled.\n",
      exitCode: 130,
      error: "Stopped by user",
    }));
    activeJobIdRef.current = null;
  }, [runnerKind]);

  const run = useCallback(
    async (
      action: TerminalAction,
      args: Record<string, string> | undefined,
      label: string,
    ): Promise<{ ok: boolean; output: string }> => {
      if (!canRun) {
        const error = "Unlock admin (top right) and ensure Docker runners are up: npm run wp-dev -- up";
        setJob({
          phase: "error",
          output: "",
          exitCode: 1,
          error,
          label,
          startedAt: null,
        });
        return { ok: false, output: error };
      }

      abortRef.current = false;
      activeJobIdRef.current = null;
      const startedAt = Date.now();
      setJob({
        phase: "running",
        output: "Starting…\n",
        exitCode: null,
        error: null,
        label,
        startedAt,
      });

      const started = await runTerminalAction(action, args, runnerKind);
      if (!started.ok) {
        setJob({
          phase: "error",
          output: started.error,
          exitCode: 1,
          error: started.error,
          label,
          startedAt,
        });
        return { ok: false, output: started.error };
      }

      activeJobIdRef.current = started.jobId;

      for (let i = 0; i < 600; i += 1) {
        if (abortRef.current) {
          return { ok: false, output: "Cancelled." };
        }

        const st = await getTerminalJobStatus(started.jobId, runnerKind);
        if (!st.ok) {
          setJob({
            phase: "error",
            output: st.error,
            exitCode: 1,
            error: st.error,
            label,
            startedAt,
          });
          activeJobIdRef.current = null;
          return { ok: false, output: st.error };
        }

        const output = st.output || "Running…\n";
        setJob((prev) => ({ ...prev, output }));

        if (st.status === "done") {
          activeJobIdRef.current = null;
          if (abortRef.current || st.exitCode === 130) {
            setJob({
              phase: "cancelled",
              output,
              exitCode: 130,
              error: "Stopped by user",
              label,
              startedAt,
            });
            return { ok: false, output };
          }
          const ok = st.exitCode === 0;
          setJob({
            phase: ok ? "success" : "error",
            output,
            exitCode: st.exitCode ?? 1,
            error: ok ? null : `Command failed (exit ${st.exitCode ?? 1})`,
            label,
            startedAt,
          });
          return { ok, output };
        }

        await new Promise((r) => window.setTimeout(r, 1000));
      }

      activeJobIdRef.current = null;
      const timeoutMsg = "Timed out after 10 minutes.\n";
      setJob({
        phase: "error",
        output: timeoutMsg,
        exitCode: 1,
        error: "Timed out after 10 minutes.",
        label,
        startedAt,
      });
      return { ok: false, output: timeoutMsg };
    },
    [canRun, runnerKind],
  );

  return { job, run, cancel, reset, outputRef, isRunning: job.phase === "running" };
};

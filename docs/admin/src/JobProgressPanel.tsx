import type { RefObject } from "react";
import type { RunnerJobState } from "./useRunnerJob";

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return m > 0 ? `${m}:${String(rem).padStart(2, "0")}` : `${s}s`;
}

type JobProgressPanelProps = {
  job: RunnerJobState;
  outputRef?: RefObject<HTMLPreElement | null>;
  onStop?: () => void;
};

export function JobProgressPanel({ job, outputRef, onStop }: JobProgressPanelProps) {
  if (job.phase === "idle") return null;

  const elapsed =
    job.startedAt != null ? formatElapsed(Date.now() - job.startedAt) : "";

  const barTone =
    job.phase === "running"
      ? "bg-brand-600"
      : job.phase === "success"
        ? "bg-emerald-500"
        : job.phase === "cancelled"
          ? "bg-amber-500"
          : "bg-red-500";

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/60">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900 dark:text-white">
          {job.label}
        </p>
        <span
          className={`text-xs font-medium ${
            job.phase === "running"
              ? "text-brand-700 dark:text-brand-300"
              : job.phase === "success"
                ? "text-emerald-700 dark:text-emerald-300"
                : job.phase === "cancelled"
                  ? "text-amber-700 dark:text-amber-300"
                  : "text-red-700 dark:text-red-300"
          }`}
        >
          {job.phase === "running"
            ? `Running… ${elapsed}`
            : job.phase === "success"
              ? `Done ${elapsed ? `(${elapsed})` : ""}`
              : job.phase === "cancelled"
                ? `Stopped ${elapsed ? `(${elapsed})` : ""}`
                : `Failed ${elapsed ? `(${elapsed})` : ""}`}
        </span>
        {job.phase === "running" && onStop ? (
          <button
            type="button"
            onClick={() => onStop()}
            className="rounded-lg border border-red-300 bg-red-50 px-3 py-1 text-xs font-semibold text-red-800 hover:bg-red-100 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200"
          >
            Stop
          </button>
        ) : null}
      </div>

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
        {job.phase === "running" ? (
          <div
            className={`h-full w-1/3 rounded-full ${barTone} motion-safe:animate-[runner-slide_1.4s_ease-in-out_infinite]`}
          />
        ) : (
          <div className={`h-full w-full rounded-full ${barTone}`} />
        )}
      </div>

      {job.error && job.phase === "error" ? (
        <p className="mt-2 text-xs text-red-700 dark:text-red-300">{job.error}</p>
      ) : null}

      <pre
        ref={outputRef}
        className="mt-3 max-h-56 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] leading-relaxed text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
      >
        {job.output || "Waiting for output…"}
      </pre>
    </div>
  );
}

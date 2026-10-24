import type { ReactNode } from "react";
import { useAdminAuth, useRunnerSecrets } from "@wpdev/web-host";
import { secondaryAccentButtonClass } from "./uiClasses";

type LockedGateProps = {
  /** One sentence when the admin session is locked. */
  message: string;
  children: ReactNode;
};

/**
 * Empty state (C.3): one sentence + one Unlock CTA. Hides primary controls until runners can run.
 */
export function LockedGate({ message, children }: LockedGateProps) {
  const { authenticated, requestUnlock } = useAdminAuth();
  const { canRun, runnerMessage } = useRunnerSecrets(message);

  if (canRun) return <>{children}</>;

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-6 dark:border-amber-900/60 dark:bg-amber-950/30">
      <p className="text-sm text-amber-950 dark:text-amber-100">
        {!authenticated ? message : runnerMessage || message}
      </p>
      {!authenticated ? (
        <button
          type="button"
          onClick={requestUnlock}
          className={`${secondaryAccentButtonClass} mt-4 rounded-lg px-4 py-2 text-sm`}
        >
          Unlock admin
        </button>
      ) : null}
    </div>
  );
}

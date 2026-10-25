import { Wizard } from "@wpdev/web-host";
import { LockedGate } from "../LockedGate";

/**
 * Primary Setup — live SSH → optional staging → first backup → ready.
 */
export function SetupStagingPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          Setup
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Connect live SSH (production.*), optionally add staging, then take a first backup.
        </p>
      </div>
      <LockedGate message="Unlock admin to configure remote servers.">
        <Wizard />
      </LockedGate>
    </div>
  );
}

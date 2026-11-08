import { Wizard } from "@wpdev/web-host";
import { LockedGate } from "../LockedGate";

/**
 * Primary Setup — pull walks Live SSH and optional Staging; local-only jumps to First backup.
 */
export function SetupStagingPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          Setup
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Create a WordPress on this computer, or save Production and Staging. Pull, push, backup,
          and updates are their own tabs.
        </p>
      </div>
      <LockedGate message="Unlock admin to configure remote servers.">
        <Wizard />
      </LockedGate>
    </div>
  );
}

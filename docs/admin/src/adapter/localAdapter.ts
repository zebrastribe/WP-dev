import type { TerminalAction } from "../api";
import type { JobResult, WpdevWebAdapter } from "./types";

type RunFn = (
  action: TerminalAction,
  args: Record<string, string> | undefined,
  label: string,
) => Promise<JobResult>;

/**
 * Localhost adapter: maps plan actions onto Docker host/terminal runners.
 * CloudAdapter (private repo) will implement the same WpdevWebAdapter shape.
 */
export function createLocalAdapter(run: RunFn): WpdevWebAdapter {
  return {
    kind: "local",
    async runJob(action, args, label, _runnerKind = "sync") {
      return run(action as TerminalAction, args, label);
    },
  };
}

export function syncActionsForRoute(direction: "push" | "pull", dryRun: boolean): TerminalAction {
  if (direction === "push") return dryRun ? "wpdev_push_dry" : "wpdev_push";
  return dryRun ? "wpdev_pull_dry" : "wpdev_pull";
}

/** Theme-only lane — files only, never touches the database (CLI: push/pull theme). */
export function themeActionsForRoute(
  direction: "push" | "pull",
  dryRun: boolean,
): TerminalAction {
  if (direction === "push") return dryRun ? "wpdev_push_theme_dry" : "wpdev_push_theme";
  return dryRun ? "wpdev_pull_theme_dry" : "wpdev_pull_theme";
}

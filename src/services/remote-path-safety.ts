import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  buildRemotePathSafetyScript,
  evaluatePathSafety,
  parseRemotePathSafetyOutput,
  type PathSafetyIssue,
  type PathSafetyReport,
} from "@wpdev/sync-engine";
import type { SshSession } from "./ssh.js";

/**
 * Remote / local WordPress `path` must be a single site root — not an account home
 * with sibling sites, and not a checkout of the wp-dev tooling repo.
 * Probe and report rules live in `@wpdev/sync-engine` so the hosted worker uses the same check.
 */

export {
  buildRemotePathSafetyScript,
  evaluatePathSafety,
  parseRemotePathSafetyOutput,
  type PathSafetyIssue,
  type PathSafetyReport,
};

const TOOLING_MARKER_CHECKS: { rel: string; label: string }[] = [
  { rel: "wp-dev.config.json", label: "wp-dev.config.json" },
  { rel: "wp-dev.config.example.json", label: "wp-dev.config.example.json" },
  { rel: "docker/terminal-runner.mjs", label: "docker/terminal-runner.mjs" },
  { rel: "docker/host-runner.mjs", label: "docker/host-runner.mjs" },
  { rel: "src/cli.ts", label: "src/cli.ts" },
  { rel: "packages/wpdev-web/package.json", label: "packages/wpdev-web" },
];

export async function inspectRemotePathSafety(
  ssh: SshSession,
  remotePath: string,
  envLabel: string,
): Promise<PathSafetyReport> {
  const script = buildRemotePathSafetyScript(remotePath);
  const r = await ssh.exec(script);
  const parsed = parseRemotePathSafetyOutput(`${r.stdout ?? ""}\n${r.stderr ?? ""}`);
  return evaluatePathSafety({
    ...parsed,
    pathLabel: remotePath,
    envLabel,
  });
}

export type AssertRemotePathSafeOptions = {
  /**
   * Staging first-push may seed an empty directory before wp-config exists.
   * Still refuses parent-of-sites and wp-dev tooling in the docroot.
   */
  allowMissingWpConfig?: boolean;
};

/**
 * Fail closed before pull/push/backup/restore touch a remote tree.
 * Prints warnings; throws on fail-level issues (wrong parent, no WP root, wp-dev in docroot).
 */
export async function assertRemotePathSafe(
  ssh: SshSession,
  remotePath: string,
  envLabel: string,
  opts: AssertRemotePathSafeOptions = {},
): Promise<PathSafetyReport> {
  const report = await inspectRemotePathSafety(ssh, remotePath, envLabel);
  const issues = opts.allowMissingWpConfig
    ? report.issues.filter((i) => i.code !== "missing_wp_config")
    : report.issues;
  for (const issue of issues) {
    const prefix = issue.level === "fail" ? "Path safety FAIL" : "Path safety WARN";
    console.error(`${prefix}: ${issue.message}`);
  }
  const failed = issues.some((i) => i.level === "fail");
  if (failed) {
    throw new Error(
      `Refusing ${envLabel} operation: remote path is unsafe (${remotePath}). ` +
        `Point path at this site’s wp-config.php directory only — not a parent of other sites, and not a WP-dev checkout. ` +
        `Run: npm run wp-dev -- doctor ${envLabel}`,
    );
  }
  return { ...report, ok: true, issues };
}

/** Local wpRoot must not be the WP-dev project checkout. */
export function inspectLocalWpRootSafety(
  wpRootAbs: string,
  envLabel = "local",
): PathSafetyReport {
  const hasWpConfig =
    existsSync(join(wpRootAbs, "wp-config.php")) ||
    existsSync(join(wpRootAbs, "wp-config-sample.php"));

  let childWpConfigCount = 0;
  try {
    for (const name of readdirSync(wpRootAbs)) {
      const child = join(wpRootAbs, name);
      try {
        if (statSync(child).isDirectory() && existsSync(join(child, "wp-config.php"))) {
          childWpConfigCount += 1;
        }
      } catch {
        /* skip */
      }
    }
  } catch {
    /* unreadable */
  }

  const toolingMarkers: string[] = [];
  for (const { rel, label } of TOOLING_MARKER_CHECKS) {
    if (existsSync(join(wpRootAbs, rel))) toolingMarkers.push(label);
  }
  const pkg = join(wpRootAbs, "package.json");
  if (existsSync(pkg)) {
    try {
      const raw = readFileSync(pkg, "utf8");
      if (/"name"\s*:\s*"wp-dev"/.test(raw)) {
        toolingMarkers.push("package.json(name=wp-dev)");
      }
    } catch {
      /* ignore */
    }
  }

  return evaluatePathSafety({
    hasWpConfig,
    childWpConfigCount,
    toolingMarkers,
    pathLabel: wpRootAbs,
    envLabel,
  });
}

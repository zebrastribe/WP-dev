import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { SshSession } from "./ssh.js";
import { posixShellQuote } from "../utils/shell-quote.js";

/**
 * Remote / local WordPress `path` must be a single site root — not an account home
 * with sibling sites, and not a checkout of the wp-dev tooling repo.
 */

export type PathSafetyIssue = {
  level: "fail" | "warn";
  code:
    | "missing_wp_config"
    | "parent_of_sites"
    | "nested_wp_installs"
    | "wpdev_tooling_in_docroot";
  message: string;
};

export type PathSafetyReport = {
  ok: boolean;
  issues: PathSafetyIssue[];
  /** True when wp-config.php or wp-config-sample.php exists at path. */
  hasWpConfig: boolean;
  /** Count of wp-config.php under path at depth 2 (immediate child site roots). */
  childWpConfigCount: number;
  /** Marker paths found that indicate a wp-dev repo inside the docroot. */
  toolingMarkers: string[];
};

const TOOLING_MARKER_CHECKS: { rel: string; label: string }[] = [
  { rel: "wp-dev.config.json", label: "wp-dev.config.json" },
  { rel: "wp-dev.config.example.json", label: "wp-dev.config.example.json" },
  { rel: "docker/terminal-runner.mjs", label: "docker/terminal-runner.mjs" },
  { rel: "docker/host-runner.mjs", label: "docker/host-runner.mjs" },
  { rel: "src/cli.ts", label: "src/cli.ts" },
  { rel: "packages/wpdev-web/package.json", label: "packages/wpdev-web" },
];

/** Shell probe: prints WPDEV_PATH_SAFETY lines for parseRemotePathSafetyOutput. */
export function buildRemotePathSafetyScript(remotePath: string): string {
  const p = posixShellQuote(remotePath.replace(/\/$/, "") || "/");
  return [
    "set +e",
    `P=${p}`,
    'HAS_WP=0; [ -f "$P/wp-config.php" ] || [ -f "$P/wp-config-sample.php" ] && HAS_WP=1',
    'CHILD_N=0; if [ -d "$P" ]; then CHILD_N=$(find "$P" -mindepth 2 -maxdepth 2 -type f -name wp-config.php 2>/dev/null | wc -l | tr -d " "); fi',
    'MARKERS=""',
    'for m in wp-dev.config.json wp-dev.config.example.json docker/terminal-runner.mjs docker/host-runner.mjs src/cli.ts packages/wpdev-web/package.json; do',
    '  [ -e "$P/$m" ] && MARKERS="$MARKERS $m"',
    "done",
    'if [ -f "$P/package.json" ] && grep -Eq \'"name"[[:space:]]*:[[:space:]]*"wp-dev"\' "$P/package.json" 2>/dev/null; then',
    '  MARKERS="$MARKERS package.json(name=wp-dev)"',
    "fi",
    'MARKERS=$(echo "$MARKERS" | sed "s/^ *//")',
    'printf "WPDEV_PATH_SAFETY has_wp=%s child_wp=%s markers=%s\\n" "$HAS_WP" "$CHILD_N" "$MARKERS"',
  ].join("\n");
}

export function parseRemotePathSafetyOutput(stdout: string): {
  hasWpConfig: boolean;
  childWpConfigCount: number;
  toolingMarkers: string[];
} {
  const line =
    stdout
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.startsWith("WPDEV_PATH_SAFETY ")) ?? "";
  const hasWp = /(?:^|\s)has_wp=1(?:\s|$)/.test(line);
  const childMatch = line.match(/(?:^|\s)child_wp=(\d+)(?:\s|$)/);
  const childWpConfigCount = childMatch ? Number(childMatch[1]) : 0;
  const markersMatch = line.match(/(?:^|\s)markers=(.*)$/);
  const raw = markersMatch ? markersMatch[1].trim() : "";
  const toolingMarkers = raw ? raw.split(/\s+/).filter(Boolean) : [];
  return {
    hasWpConfig: hasWp,
    childWpConfigCount: Number.isFinite(childWpConfigCount) ? childWpConfigCount : 0,
    toolingMarkers,
  };
}

export function evaluatePathSafety(input: {
  hasWpConfig: boolean;
  childWpConfigCount: number;
  toolingMarkers: string[];
  /** Configured path label for messages (e.g. production.path). */
  pathLabel: string;
  envLabel: string;
}): PathSafetyReport {
  const issues: PathSafetyIssue[] = [];
  const { hasWpConfig, childWpConfigCount, toolingMarkers, pathLabel, envLabel } = input;

  if (toolingMarkers.length > 0) {
    issues.push({
      level: "fail",
      code: "wpdev_tooling_in_docroot",
      message:
        `${envLabel}: wp-dev tooling was found inside ${pathLabel} (${toolingMarkers.join(", ")}). ` +
        `Keep the WP-dev project on your workstation (or a non-web folder). ` +
        `Configured path must be this site’s WordPress root only — never a WP-dev git checkout on production/staging.`,
    });
  }

  if (!hasWpConfig && childWpConfigCount > 0) {
    issues.push({
      level: "fail",
      code: "parent_of_sites",
      message:
        `${envLabel}: ${pathLabel} has no wp-config.php but ${childWpConfigCount} child site(s) do. ` +
        `Point path at this site’s WordPress root (the folder that contains wp-config.php), not the parent that holds multiple sites or logs.`,
    });
  } else if (!hasWpConfig) {
    issues.push({
      level: "fail",
      code: "missing_wp_config",
      message:
        `${envLabel}: ${pathLabel} is not a WordPress root (no wp-config.php). ` +
        `SSH in, run ls wp-config.php, and set path to that directory.`,
    });
  } else if (childWpConfigCount > 0) {
    issues.push({
      level: "warn",
      code: "nested_wp_installs",
      message:
        `${envLabel}: ${pathLabel} looks like a WordPress root, but ${childWpConfigCount} nested wp-config.php file(s) were found one level down. ` +
        `Sync/complete backup stay under this path — nested installs can be overwritten. Prefer sibling site folders outside this path.`,
    });
  }

  const ok = !issues.some((i) => i.level === "fail");
  return {
    ok,
    issues,
    hasWpConfig,
    childWpConfigCount,
    toolingMarkers,
  };
}

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

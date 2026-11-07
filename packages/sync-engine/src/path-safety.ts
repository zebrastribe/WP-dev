/**
 * One WordPress root per operation. Shared by the public CLI and the hosted worker.
 * A parent folder, a missing wp-config, or a wp-dev checkout is not a site.
 */

function posixShellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

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
  hasWpConfig: boolean;
  childWpConfigCount: number;
  toolingMarkers: string[];
};

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

/** Site updates refuse nested installs. Sync still only warns. */
export function assertSingleSiteRoot(report: PathSafetyReport, pathLabel: string): void {
  if (!report.ok) {
    const reason = report.issues.find((issue) => issue.level === "fail")?.message ?? "unsafe path";
    throw new Error(`Refusing site update: ${reason}`);
  }
  if (report.issues.some((issue) => issue.code === "nested_wp_installs")) {
    throw new Error(
      `Refusing site update: ${pathLabel} contains nested WordPress installs. Point the environment at this site’s WordPress root only.`,
    );
  }
}

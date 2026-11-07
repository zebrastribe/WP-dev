/**
 * One component on one WordPress root.
 * The hosted worker and the public CLI share this contract.
 * Git remotes are not a site update. `wp-dev update` stays the tool checkout.
 */

function posixShellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export const SITE_UPDATE_PHP_VERSIONS = ["7.4", "8.0", "8.1", "8.2", "8.3", "8.4", "8.5"] as const;
export type SiteUpdatePhpVersion = (typeof SITE_UPDATE_PHP_VERSIONS)[number];

export type SiteUpdateTarget = "php" | "core" | "plugin" | "theme";

export type ComponentUpdate =
  | { target: "core" }
  | { target: "plugin"; slug: string }
  | { target: "theme"; slug: string };

export type SiteUpdateRequest =
  | { target: "check" }
  | { target: "apply"; items: ComponentUpdate[] }
  | { target: "php"; version: SiteUpdatePhpVersion }
  | ComponentUpdate;

export type AvailableComponent = {
  slug: string;
  label: string;
  version: string;
  available: string;
};

export type UpdateCheckReport = {
  possible: boolean;
  reason?: string;
  core: { current: string; available: string | null };
  plugins: AvailableComponent[];
  themes: AvailableComponent[];
};

const SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

export function assertComponentSlug(slug: string): string {
  const trimmed = slug.trim();
  if (trimmed.toLowerCase() === "all" || trimmed.startsWith("-")) {
    throw new Error("Refusing component update: pick one plugin or theme slug, not all.");
  }
  if (!SLUG.test(trimmed)) {
    throw new Error(
      `Refusing component update: slug "${trimmed}" is not a single plugin or theme name.`,
    );
  }
  return trimmed;
}

function parseComponent(raw: { target?: unknown; slug?: unknown }): ComponentUpdate {
  if (raw.target === "core") return { target: "core" };
  if (raw.target === "plugin" || raw.target === "theme") {
    if (typeof raw.slug !== "string") {
      throw new Error(`A ${raw.target} update needs one slug.`);
    }
    return { target: raw.target, slug: assertComponentSlug(raw.slug) };
  }
  throw new Error("Each selected update must be core, one plugin, or one theme.");
}

export function parseSiteUpdate(input: unknown): SiteUpdateRequest {
  if (!input || typeof input !== "object") {
    throw new Error("Site update payload is missing");
  }
  const raw = input as { target?: unknown; version?: unknown; slug?: unknown; items?: unknown };
  if (raw.target === "check") return { target: "check" };
  if (raw.target === "apply") {
    if (!Array.isArray(raw.items) || raw.items.length === 0) {
      throw new Error("Select at least one available update.");
    }
    if (raw.items.length > 40) {
      throw new Error("Select at most 40 updates at a time.");
    }
    return {
      target: "apply",
      items: raw.items.map((item) => parseComponent(item as { target?: unknown; slug?: unknown })),
    };
  }
  if (raw.target === "php") {
    const version = typeof raw.version === "string" ? raw.version.trim() : "";
    if (!SITE_UPDATE_PHP_VERSIONS.includes(version as SiteUpdatePhpVersion)) {
      throw new Error(
        `Unsupported PHP version "${version}". Allowed: ${SITE_UPDATE_PHP_VERSIONS.join(", ")}`,
      );
    }
    return { target: "php", version: version as SiteUpdatePhpVersion };
  }
  if (raw.target === "core" || raw.target === "plugin" || raw.target === "theme") {
    return parseComponent(raw);
  }
  throw new Error("Site update target must be check, apply, php, core, plugin, or theme.");
}

function section(name: string, command: string): string {
  return [
    `${name}_code=0`,
    `${name}_body=$(${command}) || ${name}_code=$?`,
    `printf 'WPDEV_UPDATE_SECTION %s\\n%s\\nWPDEV_UPDATE_BODY\\n%s\\nWPDEV_UPDATE_SECTION_END\\n' ${name} "$${name}_code" "$${name}_body"`,
  ].join("\n");
}

/** Read-only probe: can this root apply WordPress, plugin, and theme updates, and which ones exist. */
export function buildUpdateCheckScript(wpPath: string): string {
  const root = wpPath.replace(/\/$/, "");
  if (!root.startsWith("/")) {
    throw new Error("Refusing site update: WordPress path must be absolute.");
  }
  const q = posixShellQuote(root);
  return [
    "set +e",
    section("wp", "command -v wp"),
    section("installed", `wp --path=${q} core is-installed`),
    section("version", `wp --path=${q} core version`),
    section(
      "writable",
      `wp --path=${q} eval 'echo (is_writable(ABSPATH) && is_writable(WP_CONTENT_DIR)) ? "yes" : "no";'`,
    ),
    section("core", `wp --path=${q} core check-update --format=json`),
    section(
      "plugins",
      `wp --path=${q} plugin list --update=available --format=json --fields=name,title,version,update_version`,
    ),
    section(
      "themes",
      `wp --path=${q} theme list --update=available --format=json --fields=name,title,version,update_version`,
    ),
  ].join("\n");
}

type Section = { code: number; body: string };

function readSections(stdout: string): Record<string, Section> {
  const out: Record<string, Section> = {};
  const re =
    /WPDEV_UPDATE_SECTION ([a-z_]+)\n(-?\d+)\nWPDEV_UPDATE_BODY\n([\s\S]*?)\nWPDEV_UPDATE_SECTION_END/g;
  for (const match of stdout.matchAll(re)) {
    out[match[1]] = { code: Number(match[2]), body: match[3] ?? "" };
  }
  return out;
}

function asComponents(body: string): AvailableComponent[] {
  const parsed = JSON.parse(body) as unknown;
  if (!Array.isArray(parsed)) return [];
  const items: AvailableComponent[] = [];
  for (const row of parsed) {
    if (!row || typeof row !== "object") continue;
    const rec = row as { name?: unknown; title?: unknown; version?: unknown; update_version?: unknown };
    if (typeof rec.name !== "string" || typeof rec.update_version !== "string" || !rec.update_version) {
      continue;
    }
    let slug: string;
    try {
      slug = assertComponentSlug(rec.name);
    } catch {
      continue;
    }
    items.push({
      slug,
      label: typeof rec.title === "string" && rec.title.trim() ? rec.title : rec.name,
      version: typeof rec.version === "string" ? rec.version : "",
      available: rec.update_version,
    });
  }
  return items;
}

/** Turn the remote check transcript into a report. A failed check has no selectable rows. */
export function parseUpdateCheckOutput(stdout: string): UpdateCheckReport {
  const empty = { current: "", available: null as string | null };
  const sections = readSections(stdout);
  const fail = (reason: string): UpdateCheckReport => ({
    possible: false,
    reason,
    core: empty,
    plugins: [],
    themes: [],
  });
  if (!sections.wp || sections.wp.code !== 0 || !sections.wp.body.trim()) {
    return fail("wp-cli is not installed on this host, so WordPress, plugin, and theme updates cannot run.");
  }
  if (!sections.installed || sections.installed.code !== 0) {
    return fail("WordPress is not installed at this environment’s path, so there is nothing to update.");
  }
  if (!sections.writable || sections.writable.code !== 0 || sections.writable.body.trim() !== "yes") {
    return fail(
      "This site cannot write WordPress updates (the root or wp-content is not writable). Update in the hosting panel, or fix file permissions, then check again.",
    );
  }
  for (const name of ["plugins", "themes"] as const) {
    const section = sections[name];
    if (!section || section.code !== 0) {
      return fail(
        `Could not ask WordPress.org what is available (${name}). Nothing was listed because the check did not succeed.`,
      );
    }
  }
  const coreSection = sections.core;
  const coreBody = coreSection?.body.trim() ?? "";
  const coreQuiet = !coreSection || coreSection.code === 1 && (coreBody === "" || coreBody === "[]");
  if (!coreSection || (coreSection.code !== 0 && !coreQuiet)) {
    return fail(
      "Could not ask WordPress.org about WordPress core. Nothing was listed because the check did not succeed.",
    );
  }
  let coreAvailable: string | null = null;
  if (coreBody && coreBody !== "[]") {
    try {
      const coreRows = JSON.parse(coreBody) as unknown;
      if (!Array.isArray(coreRows)) {
        return fail("WordPress core check did not return a result. Nothing was listed.");
      }
      if (coreRows.length > 0) {
        const version = (coreRows[0] as { version?: unknown }).version;
        coreAvailable = typeof version === "string" ? version : null;
      }
    } catch {
      return fail("WordPress core check did not return a result. Nothing was listed.");
    }
  }
  let plugins: AvailableComponent[] = [];
  let themes: AvailableComponent[] = [];
  try {
    plugins = asComponents(sections.plugins.body);
    themes = asComponents(sections.themes.body);
  } catch {
    return fail("Plugin or theme check did not return a result. Nothing was listed.");
  }
  return {
    possible: true,
    core: {
      current: sections.version?.code === 0 ? sections.version.body.trim() : "",
      available: coreAvailable,
    },
    plugins,
    themes,
  };
}

export function assertSelectionAvailable(report: UpdateCheckReport, items: ComponentUpdate[]): void {
  if (!report.possible) {
    throw new Error(report.reason || "Updates cannot run on this site.");
  }
  for (const item of items) {
    if (item.target === "core") {
      if (!report.core.available) {
        throw new Error("WordPress core has no update available.");
      }
      continue;
    }
    const list = item.target === "plugin" ? report.plugins : report.themes;
    if (!list.some((row) => row.slug === item.slug)) {
      throw new Error(
        `${item.target} “${item.slug}” was not in the available updates. Check again and select one that is listed.`,
      );
    }
  }
}

const PHP_SELECTOR_SNIPPET = [
  '$p = getenv("WPDEV_UPDATE_PATH");',
  '$v = getenv("WPDEV_UPDATE_VERSION");',
  'if (!is_string($p) || $p === "" || !is_string($v) || !preg_match("/^[0-9]+\\.[0-9]+$/", $v)) {',
  '  fwrite(STDERR, "Bad PHP update input\\n");',
  "  exit(2);",
  "}",
  '$p = rtrim($p, "/");',
  'if (!is_file($p . "/wp-config.php") && !is_file($p . "/wp-config-sample.php")) {',
  '  fwrite(STDERR, "Refusing PHP change: not a WordPress root\\n");',
  "  exit(2);",
  "}",
  '$ht = $p . "/.htaccess";',
  '$dot = $p . "/.php-version";',
  "if (is_file($ht)) {",
  "  $raw = file_get_contents($ht);",
  '  if (is_string($raw) && preg_match("/AddHandler\\s+.*php/i", $raw)) {',
  '    $compact = str_replace(".", "", $v);',
  '    $block = "# BEGIN WP-DEV PHP VERSION\\nAddHandler application/x-httpd-php" . $compact . " .php\\n# END WP-DEV PHP VERSION\\n";',
  '    $stripped = preg_replace("/# BEGIN WP-DEV PHP VERSION[\\s\\S]*?# END WP-DEV PHP VERSION\\n?/", "", $raw);',
  "    $stripped = rtrim((string) $stripped);",
  '    $next = ($stripped === "" ? "" : $stripped . "\\n\\n") . $block;',
  "    if (file_put_contents($ht, $next) === false) {",
  '      fwrite(STDERR, "Could not write .htaccess\\n");',
  "      exit(1);",
  "    }",
  '    echo "php selector htaccess " . $v . "\\n";',
  "    exit(0);",
  "  }",
  "}",
  "if (is_file($dot)) {",
  '  if (file_put_contents($dot, $v . "\\n") === false) {',
  '    fwrite(STDERR, "Could not write .php-version\\n");',
  "    exit(1);",
  "  }",
  '  echo "php selector .php-version " . $v . "\\n";',
  "  exit(0);",
  "}",
  'fwrite(STDERR, "No per-site PHP selector. Change PHP in the hosting panel.\\n");',
  "exit(2);",
].join("\n");

/** Remote command for this WordPress root only. Path safety runs before this. */
export function buildSiteUpdateScript(
  wpPath: string,
  request: { target: "php"; version: SiteUpdatePhpVersion } | ComponentUpdate,
): string {
  const root = wpPath.replace(/\/$/, "");
  if (!root.startsWith("/")) {
    throw new Error("Refusing site update: WordPress path must be absolute.");
  }
  const q = posixShellQuote(root);
  if (request.target === "php") {
    return `WPDEV_UPDATE_PATH=${q} WPDEV_UPDATE_VERSION=${posixShellQuote(request.version)} php -r ${posixShellQuote(PHP_SELECTOR_SNIPPET)}`;
  }
  if (request.target === "core") {
    return `wp --path=${q} core update`;
  }
  const slug = posixShellQuote(request.slug);
  const noun = request.target === "plugin" ? "plugin" : "theme";
  return `wp --path=${q} ${noun} update ${slug}`;
}

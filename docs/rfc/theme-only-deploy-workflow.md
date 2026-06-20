# RFC: Theme-only deploy workflow (production vs local dev)

**Status:** Implemented (v0.1.0)  
**See also:** `docs/theme-deploy-for-all-users.md`

---

## Problem

Today `wp-dev push production` always:

1. Backs up remote DB  
2. **Rsyncs the entire `wordpress/` tree** (minus default excludes)  
3. Exports **local** DB and imports it on production  
4. Runs URL search-replace toward `production.url`

That is correct for **cloning a site** or **full environment sync**, but wrong for day-to-day **theme development** on timework.dk:

- Local DB has demo content, localhost URLs, and experimental pages — must **not** overwrite production content.
- Theme source lives in `wp-content/themes/agency-starter/` with **Node build tooling** (`package.json`, `tailwind/`, `javascript/`, `node_modules/`, Playwright). Production only needs the compiled **`theme/`** subtree.
- Developers need **two lanes**:
  - **Open / pre-build** on localhost (watch mode, full source tree)
  - **Production-ready artifact** on timework.dk (PHP + built CSS/JS only)

`node_modules` is already in `DEFAULT_EXCLUDES`, but there is no first-class command to push **theme files only** without DB, no build step, and no manifest of what production should receive.

---

## Current workarounds (manual)

| Goal | Manual steps today |
|------|-------------------|
| Deploy theme only | `npm run prod` in theme → rsync `wordpress/wp-content/themes/agency-starter/theme/` via custom SSH, or `npm run bundle` + upload zip |
| Keep production content | **Never** run `wp-dev push production` after local content edits |
| Pull prod theme hotfix | SSH + rsync single folder back; not in wp-dev CLI |
| Fix permissions | `wp-dev fix-permissions` + `fix-runtime-permissions` (recently improved) |

---

## Proposed CLI

### 1. `wp-dev theme build`

```bash
wp-dev theme build [path]
```

- Default path: `wordpress/wp-content/themes/agency-starter` (or config key `local.themePath`)
- Runs `npm ci` (optional flag `--skip-install`) + `npm run production`
- Fails if `theme/style.css` or required `theme/js/*.min.js` missing
- Prints byte size of built assets (Lighthouse budget hook)

### 2. `wp-dev push theme <env>`

```bash
wp-dev push theme production [--dry-run] [--build]
```

- **Files only** — no DB export/import, no search-replace
- Rsync **only** `wp-content/themes/<slug>/theme/` → remote `wp-content/themes/<slug>/`
  - Or entire theme dir excluding dev paths via manifest (see below)
- `--build` runs `theme build` first
- Production confirmation prompt (same as today)
- Optional: `--activate` runs `wp theme activate <slug>` on remote via SSH

### 3. `wp-dev pull theme <env>`

```bash
wp-dev pull theme production [--dry-run]
```

- Pull remote theme `theme/` subtree into local bind mount
- Does **not** touch DB
- Runs `fix-permissions` + `fix-runtime-permissions` after pull

### 4. Theme deploy manifest (optional file)

`wp-dev.theme.json` in theme root:

```json
{
  "slug": "agency-starter",
  "build": "npm run production",
  "deploy": {
    "include": ["theme/**"],
    "exclude": ["node_modules", "javascript", "tailwind", "tests", "test-results", "playwright.config.ts"]
  }
}
```

wp-dev reads this for rsync include/exclude instead of hardcoding paths.

---

## Config additions (`wp-dev.config.json`)

```json
{
  "local": {
    "themePath": "./wordpress/wp-content/themes/agency-starter",
    "themeSlug": "agency-starter"
  },
  "production": {
    "url": "https://timework.dk"
  }
}
```

Note: `production.url` should match live `siteurl`/`home` (https + www policy).

---

## Rsync implementation sketch

```ts
// src/commands/push-theme.ts
const themeRoot = resolveThemePath(config);
const deployDir = join(themeRoot, "theme"); // or manifest-driven
await rsyncPushToPath(remote, deployDir, `${remoteWpPath}/wp-content/themes/${slug}`, opts);
// NO wpLocalDbExport, NO wpRemoteDbImport
```

Reuse `rsyncPushToPath` from `src/services/rsync.ts` (already used by `import push`).

---

## Doctor checks to add

- `wp-dev doctor` → **theme build**: verify `theme/style.css` exists and is production-minified (heuristic: no pretty-print banner / size threshold)
- `wp-dev doctor production` → warn if `production.url` uses `http://` but remote redirects to HTTPS
- Before `push production` (full): warn **"This overwrites remote DB with local DB"** — already partially there; make distinction vs `push theme` obvious in help text

---

## Documentation updates

README section: **Theme development vs full site sync**

| Command | DB | Files | Use when |
|---------|----|-------|----------|
| `pull production` | ✅ | ✅ all | New laptop, refresh local from live |
| `push production` | ✅ overwrite | ✅ all | Rare; disaster recovery or deliberate full migration |
| `push theme production` | ❌ | theme only | **Normal theme deploy to timework.dk** |
| `pull theme production` | ❌ | theme only | Pull hotfix from server |

---

## Acceptance criteria

1. `wp-dev push theme production --dry-run` shows only theme paths, no mysqldump steps in logs  
2. Production DB and uploads unchanged after theme push  
3. `wp-dev theme build` fails clearly when `npm` missing  
4. Works with existing `fix-permissions` / `fix-runtime-permissions` flow  
5. Documented in README + wizard Links step (“Deploy theme only”)

---

## Priority

**P1** for teams using block themes with a build step (Tailwind/esbuild). Full `push` remains for migrations; theme-only closes the biggest foot-gun (pushing local DB to production).

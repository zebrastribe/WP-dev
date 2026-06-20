# Theme-only deploy — implementation guide for wp-dev maintainers

**Audience:** wp-dev maintainers and project leads  
**Status:** Shipped in wp-dev CLI  
**Reference project:** timework.dk (`agency-starter` theme)

---

## Executive summary

`wp-dev push production` is designed for **full environment sync** (files + database). That is correct when bootstrapping or cloning a site, but **dangerous for theme development** — it overwrites production content with the local database.

This release adds a **theme-only lane**:

| Command | What it does |
|---------|----------------|
| `wp-dev theme build` | Runs `npm ci` + `npm run production` in the theme source tree |
| `wp-dev push theme <env>` | Rsyncs compiled theme files to `wp-content/themes/<slug>/` — **no DB** |
| `wp-dev pull theme <env>` | Rsyncs remote theme files back to the local deploy folder — **no DB** |

Aliases: `wp-dev theme push <env>`, `wp-dev theme pull <env>`.

---

## Problem statement

### What went wrong on timework.dk

Developers working on **Agency Starter** locally need:

1. **Localhost** — full source tree, watch mode, demo content, experimental pages
2. **Production (timework.dk)** — compiled PHP/CSS/JS only, **existing production DB and uploads untouched**

Using `wp-dev push production` for theme updates would:

- Export the **local** MySQL dump and import it on production
- Run URL search-replace toward `production.url`
- Rsync the entire `wordpress/` directory (minus default excludes)

That destroys production pages, posts, and media references whenever local content diverges.

### What production actually needs

Agency Starter uses the [_tw](https://underscoretw.com/) layout:

```
agency-starter/           ← theme source (package.json, tailwind/, javascript/)
  theme/                  ← WordPress theme root (style.css, functions.php, blocks/)
    style.css
    functions.php
    blocks/
    js/
```

Only the **`theme/`** subdirectory should be deployed. The host server does **not** need Node.js, `node_modules`, Playwright, or Tailwind source files.

---

## Solution overview

```
┌─────────────────────┐     theme build      ┌──────────────────────┐
│  Local source tree  │ ──────────────────►  │  Local deploy folder │
│  (host-editable)    │   npm run production │  theme/style.css     │
└─────────────────────┘                      └──────────┬───────────┘
                                                      │
                                           push theme │ rsync (files only)
                                                      ▼
                                           ┌──────────────────────┐
                                           │  Remote wp-content/  │
                                           │  themes/<slug>/      │
                                           └──────────────────────┘
```

**Database and uploads are never touched** by theme commands.

---

## Configuration

Add optional keys under `local` in `wp-dev.config.json`:

```json
{
  "local": {
    "url": "http://localhost:8894",
    "path": "./docker",
    "wpRoot": "./wordpress",
    "themePath": "./wordpress/wp-content/themes/agency-starter",
    "themeSlug": "agency-starter"
  }
}
```

| Key | Required | Default |
|-----|----------|---------|
| `themePath` | No | `<wpRoot>/wp-content/themes/agency-starter` |
| `themeSlug` | No | From `style.css` `Text Domain`, else source folder basename |

### Deploy folder detection

The CLI auto-detects theme layout:

1. **Nested (_tw):** `<themePath>/theme/style.css` exists → deploy `<themePath>/theme/`
2. **Flat:** `<themePath>/style.css` exists → deploy `<themePath>/`

Throws a clear error if neither exists.

### Remote target path

After SSH + `wp core is-installed` path resolution:

```
<remote-wp-root>/wp-content/themes/<themeSlug>/
```

Uses the same `resolveRemoteWpPath` logic as full push/pull (handles `public_html` suffixes on shared hosting).

---

## Commands (end-user reference)

### Build

```bash
npm run wp-dev -- theme build
npm run wp-dev -- theme build --skip-install   # skip npm ci
```

- Requires `package.json` in `themePath` for npm build
- Themes without a build step: skips npm, verifies `style.css` exists
- Fails if production artifacts look wrong (e.g. >120 KB `style.css`, source maps present)

### Push theme

```bash
npm run wp-dev -- push theme production --build
npm run wp-dev -- push theme production --dry-run
npm run wp-dev -- push theme staging
```

| Flag | Effect |
|------|--------|
| `--build` | Run `theme build` before rsync |
| `--dry-run` | Rsync preview only |
| `--skip-build-check` | Push even if `style.css` looks like a dev build |

Production pushes require interactive confirmation (same as full `push production`).

### Pull theme

```bash
npm run wp-dev -- pull theme production
npm run wp-dev -- pull theme production --dry-run
```

Automatically runs `fix-permissions` before pull and `fix-runtime-permissions` after (same pattern as full `pull`).

---

## Recommended workflows

### A — Theme developer (timework.dk)

```bash
# Daily local work
npm run wp-dev -- up
cd wordpress/wp-content/themes/agency-starter && npm run watch

# Ship to production
npm run wp-dev -- push theme production --build
```

**Never** run `wp-dev push production` after editing local demo content.

### B — New wp-dev project with custom theme

1. Set `local.themePath` to your theme source directory
2. Set `local.themeSlug` if it differs from `Text Domain`
3. Run `wp-dev doctor` — checks theme build state + runtime permissions
4. `wp-dev push theme staging --build` for first deploy

### C — Pull production hotfix

```bash
npm run wp-dev -- pull theme production
# Review diff in theme/ folder, commit to Git
```

### D — Full site clone (unchanged)

```bash
wp-dev pull production    # Get prod DB + files locally
wp-dev push staging       # Bootstrap staging
```

Theme commands do **not** replace full pull/push for environment cloning.

---

## Implementation details (for maintainers)

### New source files

| File | Role |
|------|------|
| `src/services/theme-path.ts` | Path resolution, slug detection, build artifact checks |
| `src/commands/theme-build.ts` | `npm ci` + `npm run production` |
| `src/commands/push-theme.ts` | SSH + rsync push to remote theme dir |
| `src/commands/pull-theme.ts` | SSH + rsync pull from remote theme dir |

### Modified files

| File | Change |
|------|--------|
| `src/config/schema.ts` | `local.themePath`, `local.themeSlug` |
| `src/services/rsync.ts` | `rsyncPullFromPath()` for subdirectory pulls |
| `src/cli.ts` | `theme build`, `push theme`, `pull theme`, `theme push/pull` aliases |
| `src/commands/doctor.ts` | Local theme build check (warn, non-fatal) |
| `README.md` | Theme-only deploy section |
| `wp-dev.config.example.json` | Example theme keys |

### Rsync excludes

Theme deploy uses the same `DEFAULT_EXCLUDES` as full sync (`node_modules`, `.git`, `wp-config.php`, etc.). Since only the compiled `theme/` folder is synced, `node_modules` is never in scope.

### Build validation heuristics

`checkThemeBuildArtifacts()` warns/fails when:

- `style.css` missing
- `style.css` > 120 KB (likely unminified dev build)
- `sourceMappingURL` present in CSS
- `functions.php` missing

Threshold is intentionally conservative; adjust in `theme-path.ts` if needed.

### Permissions interaction

| Command | Permissions |
|---------|-------------|
| `push theme` | No local permission changes |
| `pull theme` | `fix-permissions` → pull → `fix-runtime-permissions` |
| Local theme editing | `fix-permissions` keeps `themes/` host-owned |
| Plugin updates in wp-admin | `fix-runtime-permissions` keeps `upgrade/` www-data-writable |

---

## Acceptance criteria

- [x] `wp-dev theme build` compiles Agency Starter and reports deploy path
- [x] `wp-dev push theme production --dry-run` shows rsync to `wp-content/themes/agency-starter/` only
- [x] `wp-dev push theme production` does **not** export/import database
- [x] `wp-dev pull theme production` updates local `theme/` without DB changes
- [x] `wp-dev doctor` reports theme build status
- [x] Config schema accepts `themePath` / `themeSlug`
- [x] Flat themes (no `theme/` subfolder) supported
- [x] Production confirmation prompt on `push theme production`
- [x] README documents theme lane vs full push

---

## Test plan

### Automated

```bash
cd WP-dev
npm run build
npm test    # includes tests/theme-path.test.ts
```

### Manual (timework.dk)

1. `npm run wp-dev -- doctor production`
2. `npm run wp-dev -- theme build`
3. `npm run wp-dev -- push theme production --dry-run` — verify remote path only
4. `npm run wp-dev -- push theme production --build` — deploy
5. Verify timework.dk front page, blocks, and wp-admin plugin updates still work
6. Confirm production DB content unchanged (spot-check a page edited only locally)

### Regression

- `wp-dev push production --dry-run` still works (full sync unchanged)
- `wp-dev pull production` still runs fix-permissions flow
- `wp-dev fix-runtime-permissions` still fixes upgrade folder writes

---

## Migration guide for existing projects

### timework (already configured)

`wp-dev.config.json` includes:

```json
"themePath": "./wordpress/wp-content/themes/agency-starter",
"themeSlug": "agency-starter"
```

Replace manual rsync / zip upload with:

```bash
npm run wp-dev -- push theme production --build
```

### Other wp-dev clones

1. Pull latest wp-dev: `git pull && npm run build`
2. Add `themePath` / `themeSlug` to config if not using default `agency-starter`
3. Document in project README: **theme lane vs full push**
4. Optional: add `theme build` to CI before deploy

### Config URL hygiene

timework production config still has `"url": "http://timework.dk"`. Consider updating to `https://timework.dk` so any future full push search-replace uses HTTPS. Theme-only deploys are unaffected.

---

## Future enhancements (not in scope)

| Idea | Notes |
|------|-------|
| `wp-dev.theme.json` manifest | Explicit include/exclude lists per theme |
| Remote `wp cache flush` | Optional post-push hook via SSH |
| Admin UI wizard step | Theme path fields in browser config |
| `wp theme activate` after push | Only if slug changes |
| Lighthouse size gate in CI | Fail build if `style.css` exceeds budget |

---

## FAQ

**Q: Can I push theme to staging?**  
Yes: `wp-dev push theme staging --build`

**Q: What if my theme has no npm build?**  
`theme build` skips npm and checks for `style.css`. `push theme` syncs the deploy folder as-is.

**Q: Does push theme update plugins?**  
No. Only files under `wp-content/themes/<slug>/`.

**Q: I ran push production by mistake — what now?**  
Restore from the `pre-push-*.sql` snapshot printed by wp-dev, or hosting backup. Files may need manual reconciliation.

**Q: Why default to agency-starter?**  
First consumer was timework.dk; override with `themePath` for other themes.

---

## Related documents

- [RFC (original proposal)](./rfc/theme-only-deploy-workflow.md)
- [Plugin update permissions investigation](./prompts/investigate-wp-content-upgrade-permissions.md)
- [wp-dev README](../README.md#theme-only-deploy-production-safe)

---

*Last updated: June 2026 — implemented for timework.dk / Agency Starter workflow.*

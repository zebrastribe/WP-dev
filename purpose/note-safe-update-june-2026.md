# Safe upstream update — field report (June 2026)

**Audience:** wp-dev maintainers  
**Project:** timework.dk / Agency Starter (`WP-dev` clone)  
**Status:** Update completed successfully on local `main`  
**Related:** `wp-dev update`, `docs/theme-deploy-for-all-users.md`, `purpose/prompt-wp-dev-maintainer-port-stability.md`

---

## Executive summary

We updated a long-lived local wp-dev fork from upstream **`origin/main`** (9 commits behind) while preserving a large local **`wordpress/`** install (~547 MB, theme ~404 MB). The site tree is **gitignored** and was **not touched**.

The update was done **manually** (safety branch → `git pull --rebase` → merge local branch), not via the new `wp-dev update` command. Build and tests pass (**128** vitest tests). Theme artifact sanity check: `wordpress/wp-content/themes/agency-starter/theme/style.css` remained **57,345 bytes**.

This note captures what happened, where friction occurred, and concrete suggestions so wp-dev can make the next fork update safer and faster.

---

## Starting state

| Item | Value |
|------|--------|
| Local `main` vs `origin/main` | **9 commits behind** |
| Tracked local changes | **19 modified files** + many untracked additions |
| `wordpress/` | Gitignored; bind-mounted site + Agency Starter theme |
| Local-only work | Theme push/pull, import workspace, port-sync RFCs, CI theme tests, content-recovery app |

### Upstream commits absorbed (high level)

1. Fresh-clone onboarding + wp-content permission fixes  
2. Sync safety hardening, macOS quickstart, CLI expansion  
3. WordPress DB URL sync when localhost port drifts (`sync-local-urls.ts`)  
4. Port drift fix on `up` + stale localhost URL sweep in DB content  
5. `up` when wp-content owned by www-data  
6. `fix-permissions` restores runtime write paths (upgrade, plugins, uploads, cache)  
7. Deployment-unit sync selection + admin Sync tab + preview  
8. Automated test suite + SyncTab CI fix  
9. **`wp-dev update`** command + admin Update tab  

### Local branch preserved (`local/theme-deploy-and-fixes`)

Committed before pull as safety net (**104 files**, commit `2140fd3`):

- **Theme-only deploy:** `push theme`, `pull theme`, `theme build`, `theme-path.ts`, `rsyncPushToPath` / `rsyncPullFromPath`
- **Import workspace:** content-recovery PHP API + React app, `import build|ingest|push`
- **Config schema:** `local.themePath`, `local.themeSlug`, `importWorkspace`
- **Docs:** `docs/theme-deploy-for-all-users.md`, RFCs (some duplicated upstream)
- **CI:** `.github/workflows/theme-tests.yml`, Playwright theme specs
- **Scripts:** one-off theme/content patch PHP/JS (timework migration helpers)

Merged into updated `main` as commit **`668e792`**.

---

## Process used (recommended fork workflow)

```text
1. git checkout -b local/save-work-before-update
2. git add … && git commit          # snapshot all tracked + intended local work
3. git checkout main
4. git pull --rebase origin main    # fast-forward tool repo only
5. npm install && npm run build && npm test
6. git merge local/save-work-before-update
7. Resolve conflicts → npm run generate:config-artifacts → build → test
8. git commit
9. npm ci --prefix docs/admin && npm run build:wp --prefix docs/admin
10. Optional: npm run wp-dev -- down && npm run wp-dev -- up
```

**Why not `wp-dev update` alone?** The new command pulls, builds, rebuilds admin, and restarts Docker — but it does **not** merge a fork’s local commits or resolve conflicts. For forks with substantial local CLI work, a safety branch + explicit merge is still required.

---

## Merge conflicts (high-risk files)

These files conflicted because **both** upstream and the local branch changed the same surfaces:

| File | Nature of overlap | Resolution approach |
|------|-------------------|---------------------|
| `src/cli.ts` | Upstream: `update`, `sync-preview`, `sync-scan`, `quickstart`; Local: `theme`, `import` subcommands | **Manual merge** — keep both command sets |
| `src/config/schema.ts` | Upstream: `sync` deployment units; Local: `themePath`, `importWorkspace` | **Manual merge** — union of schemas |
| `package.json` | Upstream scripts vs Playwright + import scripts | **Manual merge** |
| `src/commands/up.ts`, `fix-permissions.ts`, `doctor.ts`, `wpcli.ts` | Permission + port-sync logic evolved on both sides | **Took upstream** (`--ours` during merge = current main after pull) |
| `purpose/*.md`, `compose-published-ports.ts`, related tests | Same RFC/fix developed independently | **Took upstream** (duplicate content) |
| `README.md` | Command table + troubleshooting from both sides | **Manual merge** |
| Generated schema JSON + `exampleConfig.ts` | Both sides changed schema | **Regenerated** via `npm run generate:config-artifacts` |

---

## Issues encountered (actionable for wp-dev)

### 1. Merge left broken TypeScript (bad conflict resolution)

Two bugs only appeared at `npm run build`:

**A. `src/cli.ts` — `--no-runtime` on `fix-permissions`**

Local CLI passed `{ runtime: !opts.noRuntime }` but upstream’s `FixPermissionsOptions` only has `{ quiet?: boolean }`. Upstream `cmdFixPermissions` **always** calls `cmdFixRuntimeWritePermissions` after host chown.

**Fix applied:** Remove `--no-runtime`; call `cmdFixPermissions` directly (match upstream).

**Suggestion:** If `--no-runtime` is desired, add it to `FixPermissionsOptions` and gate the runtime step in `fix-permissions.ts` — don’t split flag vs implementation across branches.

**B. `src/services/rsync.ts` — undefined `DEFAULT_EXCLUDES`**

Local fork defined `DEFAULT_EXCLUDES` inline. Upstream refactored to `SAFE_SYNC_EXCLUDES` from `sync-excludes.ts`. The merge kept upstream imports but left two theme-path functions referencing `DEFAULT_EXCLUDES`.

**Fix applied:** Use `SAFE_SYNC_EXCLUDES` in `rsyncPushToPath` and `rsyncPullFromPath`.

**Suggestion:** Add a small unit test or `tsc` CI gate on theme rsync helpers; export a shared constant if theme-only rsync needs a different exclude set than full sync.

### 2. Docker-owned files blocked git merge

`content-recovery-workspace/storage/timework/repository.sqlite` was owned by **`www-data`** (container user). Git could not overwrite it during merge checkout.

**Workaround:** Remove sqlite via one-off container / fix directory ownership (`chown` host user).

**Suggestion:** Document that `storage/` under import workspace should stay host-owned, or add `storage/**` to `.gitignore` and ship only `.gitkeep` + schema (sqlite is runtime data, not source).

### 3. `git clean -fd` removed local secrets

After a partial merge, untracked copies blocked re-merge. Running **`git clean -fd`** removed **`import.auth.env`** (gitignored credentials file).

**Workaround:** Restore from `import.auth.env.example`.

**Suggestion:** In fork-update docs / `wp-dev update` output, warn: *never `git clean` until merge is complete*; list gitignored files users should back up (`wp-dev.config.json`, `docker/.env`, `import.auth.env`).

### 4. Duplicate RFCs in `purpose/`

`purpose/rfc-sync-wordpress-url-on-port-change.md` and `prompt-wp-dev-maintainer-port-stability.md` were **both added** on upstream and local branch with similar content → merge conflict.

**Suggestion:** Treat `purpose/` as upstream-owned; forks should extend via `docs/` project notes or a single `docs/fork-overrides.md` to reduce duplicate RFC drift.

### 5. `wordpress/` preservation worked as designed

`.gitignore` on `wordpress/*` (except admin rebuild path) meant:

- Pull/rebase/merge never touched themes, uploads, or DB volume data  
- Only `wordpress/admin/` was rebuilt by `npm run build:wp --prefix docs/admin`

**No change needed** — this is the core safety guarantee and it held.

---

## Verification performed

```bash
npm install
npm run build          # tsc + generate:config-artifacts
npm test               # 128 passed
npm ci --prefix docs/admin && npm run build:wp --prefix docs/admin
wc -c wordpress/wp-content/themes/agency-starter/theme/style.css   # 57345
node dist/cli.js update --help                                     # present
node dist/cli.js theme build --help                                # present
```

Local `main` is **2 commits ahead** of `origin/main` (safety snapshot + merge). Not pushed — upstream repo does not yet contain theme-only deploy or import workspace.

---

## Recommendations for wp-dev product improvements

### P1 — Update command & fork workflow

1. **`wp-dev update --dry-run`** already lists steps — extend with a **pre-flight check**:
   - uncommitted changes count  
   - commits ahead of `origin/main`  
   - hint to create a safety branch if either is non-zero  
2. Document the **fork merge recipe** in README next to `wp-dev update` (this note can be linked or summarized).  
3. Optional: **`wp-dev update --skip-pull`** for users who already rebased (already exists — good).

### P1 — Theme-only deploy upstream

The timework fork proved the need for **`push theme` / `pull theme` / `theme build`**. See **`docs/theme-deploy-for-all-users.md`** for full spec. Upstream adoption would:

- Reduce full `push production` accidents (DB overwrite)  
- Give all Agency Starter projects a supported path  
- Centralize `rsyncPushToPath` / `theme-path.ts` maintenance  

### P2 — Merge-safe module boundaries

Split high-churn areas to reduce fork conflicts:

| Module | Responsibility |
|--------|----------------|
| `src/cli/core.ts` | Upstream commands only |
| `src/cli/extensions.ts` | Optional / project-specific registration |
| Or: plugin-style command registration | Forks register commands without editing monolithic `cli.ts` |

### P2 — Storage & permissions hygiene

- Gitignore runtime sqlite under content-recovery `storage/`  
- Run **`fix-permissions`** (or document it) before host-side git operations that touch bind-mounted paths  
- `pull theme` already calls `fix-permissions` — good pattern  

### P3 — Post-merge automation

After conflict resolution, run in CI or as `postmerge` hook:

```bash
npm run generate:config-artifacts
npm run build
npm test
```

Catches undefined symbols (`DEFAULT_EXCLUDES`) immediately.

### P3 — Admin Update tab

The new Update tab should surface:

- “You have **N local commits** not on origin — update may require merge”  
- Backup reminder for gitignored config before update  
- Link to fork-update troubleshooting  

---

## What timework retains locally (not on upstream yet)

If wp-dev maintainers cherry-pick or review for upstream:

| Feature | Entry points |
|---------|----------------|
| Theme-only rsync | `src/commands/push-theme.ts`, `pull-theme.ts`, `theme-build.ts`, `src/services/theme-path.ts` |
| Config keys | `local.themePath`, `local.themeSlug`, `importWorkspace` in schema |
| Import workspace | `content-recovery-workspace/`, `src/commands/import/*` |
| Theme CI | `.github/workflows/theme-tests.yml`, `playwright.theme.config.ts`, `tests/theme-*.spec.ts` |
| User doc | `docs/theme-deploy-for-all-users.md` |

---

## Suggested follow-up for maintainers

1. Review **`docs/theme-deploy-for-all-users.md`** for upstream merge candidacy.  
2. Add fork-update section to README referencing this note.  
3. Fix or document **`DEFAULT_EXCLUDES` vs `SAFE_SYNC_EXCLUDES`** for path-scoped rsync.  
4. Consider gitignoring **`content-recovery-workspace/storage/**/*.sqlite`**.  
5. Extend **`wp-dev update` pre-flight** for dirty tree / unpushed commits.  
6. Review **`purpose/note-admin-terminal-and-ci-june-2026.md`** — admin terminal iframe, admin save token UX, and CI fixes from the same deployment.

---

## Contact / context

- **Update date:** 2026-06-17  
- **Upstream tip merged from:** `dcb0e65` (*Add safe wp-dev update command and admin Update tab*)  
- **Local merge commit:** `668e792`  
- **Safety branch:** `local/theme-deploy-and-fixes` @ `2140fd3` (can be deleted after merge is verified)

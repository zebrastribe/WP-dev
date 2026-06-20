# Admin terminal, runner auth, and CI — field report (June 2026)

**Audience:** wp-dev maintainers  
**Project:** timework.dk (`WP-dev` clone on `zebrastribe/WP-dev`)  
**Status:** Fixes shipped on `main` (see commits below); this note is for upstream review and any remaining product work  
**Related:** `purpose/note-safe-update-june-2026.md`, `docs/admin/README.md`

---

## Executive summary

After the June 2026 upstream merge, users hit **three separate failure modes** in the admin UI and CI:

| # | Symptom | Root cause | Fixed on `main`? |
|---|---------|------------|------------------|
| 1 | Browser terminal shows **broken iframe icon** in wizard | ttyd requires HTTP basic auth; iframe URL had no credentials | **Yes** — `17e94bb` |
| 2 | Update / Terminal tabs: **“forbidden: Missing or invalid admin token”** | `WPDEV_ADMIN_SAVE_TOKEN` set in `docker/.env` but not pasted in browser; misleading “run wp-dev up” hint | **Yes** — `17e94bb` |
| 3 | **GitHub Actions failed** after push | Coverage 38.73% &lt; 39% threshold; Theme Tests workflow startup failure | **Yes** — `615bc61`, `6fdaeea` |

This report describes each issue, what was changed, and what maintainers may still want to improve in the product (docs, onboarding, CI policy).

---

## Issue 1 — Browser terminal iframe (broken document icon)

### Symptoms

- Wizard **SSH server** step (and Terminal tab): grey panel with browser “failed to load” icon inside the **Browser terminal** iframe.
- **Open in new tab** also failed or prompted for auth inconsistently.
- Stack could be running; problem persisted.

### Root causes

1. **Missing HTTP basic auth in iframe `src`**  
   ttyd is started with `-c "${WPDEV_TERMINAL_AUTH}"` (user:password). The admin UI loaded:
   ```text
   http://127.0.0.1:<port>/
   ```
   without credentials → **401 Unauthorized** → browsers render a broken iframe.

2. **Wrong default port** when secrets failed to load  
   UI defaulted to `7681` while `docker/.env` had drifted (e.g. `WPDEV_TERMINAL_PORT=7698`).

3. **Wizard did not load `terminalAuth` from API**  
   `loadTerminalRunnerSecrets()` was called but only `terminalPort` / `runnerToken` were applied — not `terminalAuth`.

4. **HTTPS admin + HTTP terminal (latent bug)**  
   Using `window.location.protocol` for the terminal URL breaks when `WPDEV_LOCAL_HTTPS=1` (mixed content). Loopback ttyd is always plain HTTP.

### Fix shipped (`17e94bb`)

| Change | File(s) |
|--------|---------|
| `buildTerminalEmbedUrl()` — embeds basic auth, always `http://127.0.0.1:<port>/` | `docs/admin/src/api.ts` |
| Shared `TerminalEmbed` component with HTTPS / not-ready messaging | `docs/admin/src/TerminalEmbed.tsx` |
| Wizard loads `terminalAuth` + port from API | `docs/admin/src/Wizard.tsx` |
| `terminalRunnerBaseUrl()` always uses `http://` (runner fetch, not iframe) | `docs/admin/src/api.ts` |

### Remaining recommendations (optional product work)

- [ ] **README:** Document that embedded terminal URL includes auth only on loopback; “Open in new tab” uses the same URL.
- [ ] **Port in README:** Terminal URL is `http://127.0.0.1:$WPDEV_TERMINAL_PORT`, not hardcoded `7681`.
- [ ] **E2E test:** Smoke test that `buildTerminalEmbedUrl("user:pass", 7681)` produces a parseable URL (unit test in admin package).
- [ ] **HTTPS admin:** Consider reverse-proxying ttyd on the HTTPS port or show a single prominent “open terminal” link when embed is blocked.

---

## Issue 2 — Admin save token / runner “forbidden”

### Symptoms

- **Update** tab: `Host runner not ready (forbidden: Missing or invalid admin token.)` + unhelpful “Run npm run wp-dev -- up”.
- **Terminal** tab: same `forbidden` error; action buttons disabled.
- User had run `wp-dev up`; stack was fine.

### Root cause

When `WPDEV_ADMIN_SAVE_TOKEN` is set in `docker/.env` (required for save + secret GET endpoints), the browser must send header **`X-WP-DEV-Admin-Token`** on:

- `GET terminal-runner-secrets`
- `POST` save / runner actions

Without the token in the UI, API returns **403 forbidden**. This is **correct security behavior** — but UX was poor:

- Update tab always appended “run wp-dev up” even for `forbidden`.
- Admin save token field was **below** the error banner (easy to miss).
- **Sync tab** had no token field at all (only read from localStorage if set elsewhere).
- Wizard **did not persist** token to localStorage (unlike other tabs).

### Fix shipped (`17e94bb`)

| Change | File(s) |
|--------|---------|
| `formatTerminalRunnerSecretsError()` — error-specific hints (`forbidden` → paste token from `docker/.env`) | `docs/admin/src/api.ts` |
| Shared `AdminSaveTokenField` on Update, Terminal, Sync, Backup, History | `docs/admin/src/AdminSaveTokenField.tsx` + tabs |
| Token field **above** status banner on Update / Terminal | tab layout |
| Wizard initializes/persists token via `readStoredAdminSaveToken` / `writeStoredAdminSaveToken` | `docs/admin/src/Wizard.tsx` |

### Remaining recommendations

- [ ] **First-run banner:** If `GET terminal-runner-secrets` returns `forbidden`, show a one-time modal: “Copy `WPDEV_ADMIN_SAVE_TOKEN` from docker/.env”.
- [ ] **Wizard step 0:** Mention save token before SSH step (users hit terminal on step 1 without token).
- [ ] **API:** Consider `503 token_not_configured` vs `403 forbidden` in UI copy (different fixes).
- [ ] **docs/admin/README.md:** Add troubleshooting row for `forbidden` on Update/Terminal.

---

## Issue 3 — CI failures after merge push

### 3a — Coverage threshold (main CI workflow)

**Failure:**
```text
ERROR: Coverage for lines (38.73%) does not meet global threshold (39%)
```

**Cause:** Merge added large untested surfaces under `vitest` coverage includes:

- `src/services/rsync.ts` — **0%** (theme push/pull path helpers)
- `src/services/sync-local-urls.ts` — pure helpers untested (tests targeted `src/utils/sync-local-urls.ts` only)
- `src/utils/import-basic-auth.ts` — **0%**

**Fix shipped (`615bc61`):**

- `tests/rsync-theme-path.test.ts` (mocked `execa`)
- `tests/service-sync-local-urls.test.ts`
- `tests/import-basic-auth.test.ts`

Coverage restored to **~44%**.

**Recommendations:**

- [ ] When adding new `src/services/**` files, add tests in the same PR or expect CI failure.
- [ ] Consider per-file thresholds for `rsync.ts` or document it as integration-only and exclude from coverage (less ideal than tests).
- [ ] Run `npm run test:coverage` locally before push (document in CONTRIBUTING if added).

### 3b — Theme Tests workflow

**Failure (first attempt):** `Some specified paths were not resolved` — `wordpress/wp-content/themes/agency-starter/package-lock.json` missing on GitHub ( **`wordpress/` is gitignored** ).

**Failure (second attempt):** Job-level `if: hashFiles(...) != ''` → **workflow startup failure** (0s run, no jobs).  
**GitHub does not allow `hashFiles()` in job-level `if:`** — only at step runtime.

**Fix shipped (`6fdaeea`):**

- Checkout → shell step detects theme → `if: steps.theme.outputs.present == 'true'` on subsequent steps.
- When theme absent: workflow **succeeds** with skip message (correct for default wp-dev clones).

**Recommendations:**

- [ ] **Document in workflow comment** — do not use `hashFiles()` in job-level `if:` (link to this note).
- [ ] **Long-term:** Theme CI should run against a **theme submodule**, separate repo, or checked-in fixture — not gitignored `wordpress/`.
- [ ] **Path filters:** Consider removing `.github/workflows/theme-tests.yml` from `on.push.paths` so workflow edits alone do not trigger a run (optional).

---

## Commits reference (timework fork → `main`)

| Commit | Summary |
|--------|---------|
| `17e94bb` | Admin terminal embed auth + admin save token UX |
| `615bc61` | CI coverage tests + theme workflow skip (first attempt) |
| `6fdaeea` | Theme Tests workflow — step-level skip (fix startup failure) |
| `c33eec1` | Update pre-flight checks (upstream; addresses fork-update doc from field report) |

---

## Verification checklist for maintainers

After pulling `main` and rebuilding admin:

```bash
npm run build
npm run test:coverage    # must pass ≥39% global threshold
npm run build:wp --prefix docs/admin
npm run wp-dev -- up
```

In browser (`http://localhost:<WP_PORT>/admin/`):

1. Paste **`WPDEV_ADMIN_SAVE_TOKEN`** from `docker/.env` into **Admin save token** on Update or Terminal tab.
2. Status banner turns green (“Host runner ready” / “Runner security loaded”).
3. Wizard SSH step: **Browser terminal** shows shell (not broken icon).
4. Update tab: pre-flight check loads; **Update wp-dev now** enabled.

On GitHub Actions:

- **CI** — green on push to `main`.
- **Theme Tests** — green with “Theme not checked in — skipping” when `wordpress/` theme absent.

---

## Cross-reference

- Safe fork update process: **`purpose/note-safe-update-june-2026.md`**
- Theme-only deploy spec: **`docs/theme-deploy-for-all-users.md`**
- Port / URL sync: **`purpose/prompt-wp-dev-maintainer-port-stability.md`**

---

**Report date:** 2026-06-20  
**Reporter context:** timework.dk / Agency Starter local clone  
**Repo:** `https://github.com/zebrastribe/WP-dev` (`main` @ `6fdaeea` or later)

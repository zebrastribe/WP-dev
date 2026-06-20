# RFC: Sync WordPress URLs when local published port changes

> **Status:** partially implemented in timework fork — see `purpose/prompt-wp-dev-maintainer-port-stability.md`  
> **Reporter:** timework clone / local dev  
> **Affects:** `wp-dev up`, `wp-dev ssl enable|disable`, `wp-dev doctor`

---

## Message to send (copy from here)

```
Subject: wp-dev up — WordPress DB URLs drift when WP_PORT is auto-adjusted

Hi — recurring local startup issue on multi-clone machines.

Symptom
-------
`npm run wp-dev up` prints the correct URL (e.g. http://localhost:8890) and Docker is listening on that port, but the browser redirects to an old localhost port (e.g. 8889) and the site appears "down".

Root cause
----------
When `ensureNonConflictingPublishedPorts()` bumps `WP_PORT`, wp-dev already updates:
- docker/.env (WP_PORT, WPDEV_TERMINAL_RUNNER_ORIGIN)
- wp-dev.config.json local.url (via maybeUpdateLocalUrlPort)

It does NOT update WordPress `home` / `siteurl` in the DB. Pull does (wpLocalForceSiteUrls), but up/ssl do not. Cached redirects (e.g. WP Fastest Cache) can mask fixes until cache flush.

Repro
-----
1. Run clone A on WP_PORT=8889 long enough that WP home/siteurl = http://localhost:8889
2. Run another clone that occupies 8888/8889
3. Run `wp-dev up` on clone A → auto-adjusts to 8890, updates config files
4. curl http://127.0.0.1:8890/ → 301 Location: http://localhost:8889/

Ask
---
Please add a permanent fix in the wp-dev repo. Full spec: purpose/rfc-sync-wordpress-url-on-port-change.md

Summary of desired behavior:
- After compose is up, if published local URL (from getPublishedLocalAccess) differs from WP home/siteurl on loopback, sync WP URLs automatically (same as pull’s force step), plus optional search-replace for common old localhost variants and cache flush.
- Run on every `wp-dev up` (idempotent), not only when port changed.
- Extend `wp-dev doctor` with optional local HTTP probe that fails on redirect to wrong localhost port.
- Tests + README troubleshooting row.

Happy to review a PR or test on timework clone.
```

---

## Problem statement

Developers running **multiple wp-dev clones** on one machine hit port conflicts. `wp-dev up` resolves this by auto-allocating free ports and updating host-side config. WordPress inside Docker still stores the **previous** `home` and `siteurl`, so HTTP requests to the new port redirect to a dead port.

This is confusing because:

1. The CLI output looks successful (`Local WordPress: http://localhost:8890`).
2. `docker/.env` and `wp-dev.config.json` already match the new port.
3. The failure only appears in the browser (redirect loop or connection refused).

Manual workaround today:

```bash
docker compose -p <project> -f docker/docker-compose.yml run --rm wpcli \
  wp option update siteurl 'http://localhost:<WP_PORT>' --allow-root
docker compose -f docker/docker-compose.yml -p <project> run --rm wpcli \
  wp option update home 'http://localhost:<WP_PORT>' --allow-root
docker compose -f docker/docker-compose.yml -p <project> run --rm wpcli \
  wp cache flush --allow-root
```

That should not be required after every port bump.

---

## Current behavior (code references)

| Layer | Updated on port change? | Where |
|-------|-------------------------|-------|
| `docker/.env` `WP_PORT` | Yes | `ensureNonConflictingPublishedPorts()` in `src/commands/up.ts` |
| `wp-dev.config.json` `local.url` | Yes (if old port matched) | `maybeUpdateLocalUrlPort()` |
| `WPDEV_TERMINAL_RUNNER_ORIGIN` | Yes (if old port matched) | `maybeUpdateRunnerOriginPort()` |
| WordPress `home` / `siteurl` | **No** | Only on `pull` via `wpLocalForceSiteUrls()` |
| Plugin caches / transients | **No** | — |
| CLI printed URL | Uses `WP_PORT` even if `local.url` stale | `getPublishedLocalAccess()` in `src/utils/published-local-urls.ts` |

Related gaps:

- `cmdSslEnable` / `cmdSslDisable` update `local.url` but not WordPress DB URLs.
- `wp-dev doctor` checks remotes only; no local redirect probe.
- README troubleshooting mentions matching `local.url` to `WP_PORT`, but not WordPress DB options.

---

## Proposed solution

### 1. New service: `syncLocalWordPressUrls(loaded)`

Add something like `src/services/sync-local-urls.ts` (name flexible) that:

1. **Resolves target URL** using existing `getPublishedLocalAccess(loaded).site` (respects HTTP vs HTTPS, `WP_PORT` vs `WP_HTTPS_PORT`, loopback host normalization).

2. **Reads current WP URLs** via WP-CLI (only if stack is up and WP is installed):
   - `wp option get home`
   - `wp option get siteurl`
   - Skip silently if DB not ready / not installed (first boot).

3. **Compares loopback URLs only** — sync when:
   - Both current and target use loopback host (`localhost`, `127.0.0.1`, `::1`), and
   - Normalized URL (scheme + host + port + no trailing slash) differs.

   Do **not** rewrite production-like hosts accidentally left in a local DB.

4. **Applies fix** (reuse existing helpers in `src/services/wpcli.ts`):
   - `wpLocalForceSiteUrls(configDir, config, targetUrl)` for `home` + `siteurl`.
   - If old URL is known (previous `local.url` port or previous WP option value), run **narrow** `wp search-replace`:
     - `http://localhost:<oldPort>` → target (and `https://` variant if SSL enabled)
     - `--skip-columns=guid`
     - Only when old/new are both loopback — same safety as pull.

5. **Best-effort cache flush** after URL change:
   - `wp cache flush` if WP-CLI succeeds.
   - Log at info level; warn on failure (non-fatal).

6. **Return a result** for logging, e.g. `{ changed: boolean, from?: string, to: string, warnings: string[] }`.

### 2. Call site: `cmdUp`

After `docker compose up -d` succeeds (and after the port-conflict retry path), call `syncLocalWordPressUrls(loaded)`.

Run on **every** successful `up`, not only when `WP_PORT` changed — covers cases where config was fixed manually but DB was not.

If sync changes URLs, print one line:

```
Synced WordPress home/siteurl to http://localhost:8890 (was http://localhost:8889)
```

If sync detects mismatch but WP-CLI fails, print warning with manual commands (same as troubleshooting).

Optional: when `ensureNonConflictingPublishedPorts` changes `WP_PORT`, pass `previousUrl` into sync so search-replace can catch Polylang transients and serialized options that still embed the old port.

### 3. Call site: `cmdSslEnable` / `cmdSslDisable`

After telling user to restart stack, either:

- Document that they must run `up` again (which syncs), **or**
- Call the same sync helper after config write (prefer calling from `up` only to avoid duplicate logic — but document clearly).

### 4. Extend `wp-dev doctor` (local check)

Add optional local probe (default on when stack containers are running, or behind `--local` flag):

1. Read published URL from `getPublishedLocalAccess`.
2. `GET` with redirect following disabled; follow up to 6 hops (reuse `probeHttpUrl` pattern from `doctor.ts`).
3. **FAIL** if any redirect `Location` uses loopback with a port ≠ published port.
4. **FAIL** if final URL port ≠ published port.
5. **WARN** if `home`/`siteurl` from WP-CLI ≠ published URL (even before HTTP probe).

This catches the bug before the user opens a browser.

### 5. Documentation

Update `README.md` Troubleshooting:

| Problem | What to try |
|---------|-------------|
| **Site redirects to wrong localhost port after `up`** | Fixed automatically on `up` (sync). If not: check `docker/.env` `WP_PORT`, run `wp-dev doctor --local`, manual `wp option update` + `wp cache flush`. |

Mention in `wp-dev up` output when auto-port-adjust happens:

```
WordPress DB URLs will be synced to the published port after the stack starts.
```

---

## Acceptance criteria

- [ ] Fresh clone: `up` does nothing harmful when WP not installed yet.
- [ ] Clone with `home=siteurl=http://localhost:8889`, `WP_PORT` bumped to 8890: after `up`, `curl -I http://127.0.0.1:8890/` does not redirect to 8889.
- [ ] Idempotent: second `up` does not rewrite DB again.
- [ ] Non-loopback `siteurl` (edge case) is not overwritten.
- [ ] `pull` behavior unchanged; sync helper shared where possible.
- [ ] Unit tests for URL comparison / loopback detection (pure functions).
- [ ] Integration test mocked WP-CLI calls optional; at minimum test planning logic without Docker.
- [ ] `npm test` and `npm run check` pass.

---

## Test ideas

**Unit** (`tests/sync-local-urls.test.ts`):

- `shouldSyncLoopbackUrl('http://localhost:8889', 'http://localhost:8890')` → true
- `shouldSyncLoopbackUrl('https://example.com', 'http://localhost:8890')` → false
- `normalizeLoopbackUrl` strips trailing slash, treats missing port as 80/443

**Extend** `tests/published-local-urls.test.ts`:

- Document that printed URL is the sync target (already covered).

**Manual QA script** (for PR description):

```bash
# Set stale WP URLs, bump port in docker/.env, up, verify no redirect
wp option update siteurl http://localhost:8889 --allow-root
wp option update home http://localhost:8889 --allow-root
# edit WP_PORT to free port, wp-dev up
curl -sI http://127.0.0.1:$WP_PORT/ | grep -i location
```

---

## Non-goals (V1)

- Rewriting Polylang language domain tables beyond simple loopback port search-replace.
- Fixing theme hardcoded demo URLs in PHP/patterns (separate theme concern).
- Changing port allocation strategy (keeping current auto-bump is fine).

---

## Real incident (timework clone, 2026-06-13)

- `WP_PORT=8890` (auto-adjusted), `local.url` correct.
- WordPress `home`/`siteurl` still `http://localhost:8889`.
- `curl http://127.0.0.1:8890/` → `Location: http://localhost:8889/`.
- After `option update` + `cache flush` → `HTTP 200` at `http://localhost:8890/`.

Other stacks on same host: `stri-be` on 8891, orphan `docker-db-1`, etc. — typical multi-clone port pressure.

---

## Implementation sketch (for reviewer)

```ts
// src/services/sync-local-urls.ts
export async function syncLocalWordPressUrls(
  loaded: LoadedConfig,
  opts?: { previousPublishedUrl?: string },
): Promise<SyncLocalUrlsResult> {
  const { site: targetUrl } = getPublishedLocalAccess(loaded);
  if (!isLoopbackUrl(targetUrl)) return { changed: false, to: targetUrl, warnings: [] };

  const installed = await wpLocalIsInstalled(...); // or try/catch on option get
  if (!installed) return { changed: false, to: targetUrl, warnings: [] };

  const home = await wpLocalOptionGet(..., "home");
  const siteurl = await wpLocalOptionGet(..., "siteurl");

  if (normalizeLoopback(home) === normalizeLoopback(targetUrl) &&
      normalizeLoopback(siteurl) === normalizeLoopback(targetUrl)) {
    return { changed: false, to: targetUrl, warnings: [] };
  }

  const oldCandidates = uniqueLoopbackVariants([home, siteurl, opts?.previousPublishedUrl]);
  await wpLocalForceSiteUrls(..., targetUrl);
  for (const old of oldCandidates) {
    if (old && normalizeLoopback(old) !== normalizeLoopback(targetUrl)) {
      await wpLocalSearchReplace(..., old, targetUrl); // loopback-only guard inside
    }
  }
  await wpLocalCacheFlushBestEffort(...);
  return { changed: true, from: home, to: targetUrl, warnings: [] };
}
```

Call from end of `cmdUp()` after compose success, before `printPublishedAccessUrls()`.

---

## Open questions for maintainer

1. Should sync also run at end of `pull` instead of duplicating force + search-replace logic there?
2. Prefer `--local` flag on doctor or always run local probe when `wordpress` container is up?
3. Should `ssl enable` immediately sync to HTTPS URL, or only after next `up`?

Default recommendation: **sync on every successful `up` only**; doctor local probe **opt-in via `--local`** to keep doctor fast.

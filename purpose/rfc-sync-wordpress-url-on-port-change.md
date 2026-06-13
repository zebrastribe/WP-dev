# RFC: Sync WordPress DB URLs when local port changes

## Problem

On machines running multiple wp-dev clones, `ensureNonConflictingPublishedPorts()` may bump `WP_PORT` when the configured port is in use. wp-dev already updates:

- `docker/.env` (`WP_PORT`, `WPDEV_TERMINAL_RUNNER_ORIGIN`)
- `wp-dev.config.json` `local.url` (when the old port matches the previous `WP_PORT`)

WordPress **`home`** and **`siteurl`** in the database are **not** updated by `up` or `ssl`. They remain on the old localhost port until the next `pull` (which calls `wpLocalForceSiteUrls`).

**Symptom:** Docker listens on `http://localhost:8890` but the site 301-redirects to `http://localhost:8889` and appears broken.

Caching plugins (e.g. WP Fastest Cache) can persist wrong redirects until cache flush.

## Desired behavior

1. **After `wp-dev up`** (stack running, MySQL ready): if the published local URL from `getPublishedLocalAccess()` differs from loopback `home` / `siteurl`, sync automatically.
2. **Idempotent:** no-op when URLs already match.
3. **Same steps as pull:** search-replace stale loopback variants → force `home`/`siteurl` → best-effort `wp cache flush`.
4. **Align config:** when `local.url` port ≠ `WP_PORT`, update `local.url` before DB sync.
5. **`wp-dev doctor --local-http`:** probe local URL; fail on redirect to wrong localhost port or stale DB URLs.
6. **README troubleshooting** row for this scenario.

## Implementation

- `src/utils/sync-local-urls.ts` — `syncLocalWordPressUrls()`, helpers
- `src/commands/up.ts` — call sync after MySQL ready
- `src/commands/doctor.ts` — `--local-http` local probe
- `tests/sync-local-urls.test.ts` — pure helper tests

## Non-goals

- Replacing remote URLs in the DB (only loopback / published local URL).
- Running sync when WordPress is not installed.

## Verification

```bash
# Repro: clone with stale DB port, then up
npm run wp-dev -- up
curl -I http://127.0.0.1:<WP_PORT>/   # Location should match WP_PORT

npm run wp-dev -- doctor --local-http
```

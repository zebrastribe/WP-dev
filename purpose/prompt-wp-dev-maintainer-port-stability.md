# Port stability and WordPress URL sync (maintainer spec)

## Symptoms (multi-clone machines)

- Browser on `http://localhost:8894` but nav links hover `http://localhost:8889`
- Every `wp-dev up` prints “Auto-adjusted published ports…” without external conflict (8890→8892→8893→8894)
- `home`/`siteurl` correct while menus, blocks, and post content still reference old ports

## Root causes

### 1. Port drift on every `up`

`ensureNonConflictingPublishedPorts()` called `isPortFree(port)` **before** compose started. This clone’s **own** running containers already bind `WP_PORT`, so the check failed and wp-dev bumped the port on every re-run.

**Fix:** `src/utils/compose-published-ports.ts` — parse `docker compose ps --format json` and treat host ports published by **this** compose project as available.

### 2. WordPress DB content not synced

Updating `docker/.env` and `wp-dev.config.json` is insufficient. Menu `_menu_item_url`, patterns, and post content can keep stale `http://localhost:OLD`.

Syncing only when `home`/`siteurl` differ misses the common case where options match but content does not.

**Fix:** `src/utils/sync-local-urls.ts` — on every `up` (when WP installed):

- Force `home`/`siteurl` when mismatched
- Regex DB sweep: `http://localhost:[0-9]+` (and https / 127.0.0.1 variants) → published URL
- Cache flush; report content replacement count

### 3. Spurious “restart required” noise

`ensureSecurityEnvDefaults()` reset `WPDEV_TERMINAL_RUNNER_ORIGIN` whenever it matched `/^https?:\/\/localhost(:\d+)?$/` — i.e. almost always.

**Fix:** Only reset runner origin when missing, placeholder, or loopback port ≠ `WP_PORT`.

### 4. `local.url` not updated when port drifted without matching oldPort

`maybeUpdateLocalUrlPort()` only updated when `local.url` port === previous `WP_PORT`.

**Fix:** Update loopback `local.url` whenever its port ≠ new `WP_PORT`.

## Verification

```bash
npm run wp-dev -- up          # should NOT bump ports when stack already owns them
npm run wp-dev -- up          # repeat — still stable
npm run wp-dev -- doctor --local-http
```

After port change, `up` should report content URL replacements when menus/content had stale ports.

## Related

- `purpose/rfc-sync-wordpress-url-on-port-change.md` — original home/siteurl sync RFC

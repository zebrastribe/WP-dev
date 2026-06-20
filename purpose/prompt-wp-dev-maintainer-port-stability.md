# Prompt for wp-dev maintainer — port stability & WordPress URL sync

> **Status:** partial fix implemented in timework fork (ready for review/merge upstream)  
> **Full RFC:** `purpose/rfc-sync-wordpress-url-on-port-change.md`  
> **Reporter:** timework local dev

---

## Copy-paste message (send this)

```
Subject: wp-dev up — root-cause fix for port drift + stale localhost URLs in WordPress

Hi — we hit recurring “site looks down” issues on multi-clone machines. Docker was fine; WordPress and wp-dev config were out of sync. I’ve prototyped a fix in our timework fork; details below for upstream merge.

Symptoms
--------
- Browser on http://localhost:8894 but status-bar links hover http://localhost:8889
- Every `npm run wp-dev -- up` printed “Auto-adjusted published ports…” even when nothing else changed (8890→8892→8893→8894…)
- `home`/`siteurl` could be correct while nav menus and block content still pointed at old ports

Root causes (three separate bugs)
---------------------------------
1. PORT DRIFT ON EVERY `up`
   `ensureNonConflictingPublishedPorts()` uses `isPortFree(port)` before compose starts.
   If this clone’s own containers already publish that port, `isPortFree` returns false → wp-dev bumps WP_PORT again on every re-run.

2. WORDPRESS DB CONTENT NOT SYNCED
   Updating docker/.env + wp-dev.config.json is not enough. Menu `_menu_item_url` postmeta, synced patterns, and post content kept `http://localhost:8889` while WP_PORT was 8894.
   Syncing only `home`/`siteurl` when they differ misses the common case where options match but content does not.

3. SPURIOUS “RESTART REQUIRED” NOISE
   `ensureSecurityEnvDefaults()` reset `WPDEV_TERMINAL_RUNNER_ORIGIN` whenever it matched `/^https?:\/\/localhost(:\d+)?$/` — i.e. always — printing restart guidance on every `up` even when the port was already correct.

Proposed / prototyped fix
-------------------------
A. Port stability (`src/utils/compose-published-ports.ts`)
   - Parse `docker compose ps --format json` → set of ports owned by THIS project
   - Treat owned ports as available for this clone (not conflicts)
   - If running stack already publishes docker/.env ports → skip reallocation entirely
   - Log: `Published ports unchanged (stack already bound): WP_PORT=…`

B. WordPress URL sync (`src/services/sync-local-urls.ts`, called from `cmdUp`)
   - After successful compose up: force `home`/`siteurl` when loopback and mismatched
   - Run regex search-replace across DB for stale loopback origins:
     `#http://localhost:[0-9]+#` → published URL (use `[0-9]+`, not `\d` — WP-CLI quirk)
     same for `127.0.0.1`, and https variants when SSL enabled
   - `wp cache flush` after changes
   - Print: `Synced local URLs to … · N content URL(s) updated in DB`

C. Security env defaults (`ensureSecurityEnvDefaults` in up.ts)
   - Only reset `WPDEV_TERMINAL_RUNNER_ORIGIN` when loopback port ≠ current WP_PORT

D. `maybeUpdateLocalUrlPort`
   - Update wp-dev.config.json local.url whenever loopback port ≠ new WP_PORT (not only when it equalled the previous port)

Tests added in fork
-------------------
- tests/compose-published-ports.test.ts
- tests/sync-local-urls.test.ts (extended)
- README troubleshooting row updated

Repro (before fix)
------------------
1. `wp-dev up` on timework → WP_PORT=8889
2. Run `wp-dev up` again while stack running → WP_PORT bumps to 8890, 8891, …
3. curl -sL http://127.0.0.1:<WP_PORT>/ | grep localhost:8889 → nav links still stale
4. `wp post meta get 131 _menu_item_url` → http://localhost:8889/ while siteurl is 8894

Acceptance criteria for upstream merge
--------------------------------------
- [ ] Re-running `up` while stack is running does NOT change WP_PORT
- [ ] Port only bumps when another process/clone actually conflicts
- [ ] After port change, all loopback URLs in DB match published port (menus, content, options)
- [ ] Idempotent second `up` (0 DB replacements)
- [ ] No spurious “Auto-updated docker/.env security values” when origin already matches WP_PORT
- [ ] `npm test` passes

Still optional (not in fork yet)
--------------------------------
- `wp-dev doctor --local` HTTP probe: fail if redirect Location uses wrong localhost port
- Call same sync helper from `ssl enable` / after port conflict retry path documents clearly

Ask
---
Please review and merge the port-stability + DB URL sync approach into upstream wp-dev. Full spec + implementation sketch: purpose/prompt-wp-dev-maintainer-port-stability.md and purpose/rfc-sync-wordpress-url-on-port-change.md

Happy to open a PR from timework or pair on review.
```

---

## Technical summary for reviewer

### Bug 1 — own containers treated as conflicts

**Before:**

```typescript
// up.ts — allocate()
if (!used.has(candidate) && (await isPortFree(candidate))) {
  return candidate;
}
candidate += 1; // bumps even when timework-wordpress-1 owns 8894
```

**After:**

```typescript
const owned = await getComposePublishedPorts(loaded);
if (composePortsMatchEnv(owned, current)) return; // stable — do nothing

const portAvailable = async (port: number) =>
  !used.has(port) &&
  (isPortOwnedByCompose(port, owned) || (await isPortFree(port)));
```

### Bug 2 — options-only sync

Menu items store URL in `postmeta._menu_item_url`, not in `home`/`siteurl`.

Verified on timework:

| Check | Before fix |
|-------|------------|
| `wp option get home` | `http://localhost:8894` ✓ |
| `wp post meta get 131 _menu_item_url` | `http://localhost:8889/` ✗ |
| Homepage HTML nav hrefs | mix of 8889 and 8894 |

**Fix:** `replaceStaleLoopbackOriginsInDb()` with WP-CLI `--regex`:

```
#http://localhost:[0-9]+#  →  http://localhost:<WP_PORT>
```

**Important:** `\d` in the pattern matched **zero** rows; `[0-9]+` matched 11.

### Bug 3 — runner origin false positive

**Before:** any `http://localhost:8894` matched “needs reset” regex → wrote same value → `changed = true` → restart message.

**After:** compare numeric port to `WP_PORT`; only write when different.

---

## Files touched in timework fork

| File | Purpose |
|------|---------|
| `src/utils/compose-published-ports.ts` | Parse compose published ports; match env |
| `src/services/sync-local-urls.ts` | Options sync + regex DB sweep |
| `src/services/wpcli.ts` | `wpLocalSearchReplaceRegex()` |
| `src/commands/up.ts` | Stable allocation; security env fix; call sync |
| `tests/compose-published-ports.test.ts` | Unit tests |
| `tests/sync-local-urls.test.ts` | URL normalization tests |
| `README.md` | Troubleshooting row |

---

## Operator guidance (document in README)

1. **One clone:** set `WP_PORT=8888` in `docker/.env`, then `down && up` once — ports stay stable on subsequent `up`.
2. **Multiple clones:** each needs its own port block; stop unused stacks with `wp-dev down`.
3. **Always use the URL printed by `wp-dev up`**, not bookmarks from earlier sessions.
4. **Do not** manually fix with `wp option update` alone — content URLs need the DB sweep.

---

## Related

- Original RFC (options-only scope): `purpose/rfc-sync-wordpress-url-on-port-change.md`
- Real incident ports observed: 8888 → 8889 → 8890 → 8892 → 8893 → 8894 on repeated `up` with stri-be + timework clones

# Sync troubleshooting

## Empty SQL dump after pull

**Symptoms:** Pull finishes but database is empty or import fails.

**Cause:** WP-CLI error on remote, wrong `path`, or permissions.

**Fix:** Check `logs/wp-dev.log`. Run `doctor production`. Verify `wp` works on server.

**Verify:** `npm run wp-dev -- status` shows WordPress installed.

---

## Wrong URLs after pull

**Symptoms:** Links point to production URL or wrong localhost port.

**Fix:** Ensure `local.url` and `production.url` are correct. Run `up` to sync URLs.

```bash
npm run wp-dev -- doctor --local-http
```

---

## Partial sync after failure

**Symptoms:** Pull/push stopped mid-way.

**Database:** WP-dev rolls back from pre-pull/pre-push backup when possible — path in CLI output.

**Files:** Re-run after fixing error, or restore from `wp-dev backup --files`.

---

## Table prefix mismatch

**Symptoms:** Pull warns about prefix; tables not found.

**Fix:** Set `WORDPRESS_TABLE_PREFIX` in `docker/.env`, then:

```bash
npm run wp-dev -- down
npm run wp-dev -- up
```

---

## Related

- [Syncing guide](../guides/syncing.md)
- [Backups](../guides/backups.md)

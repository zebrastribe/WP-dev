# Syncing (pull and push)

WP-dev syncs **files** (rsync) and the **database** (export, import, URL search-replace) between your local Docker site and remote staging or production.

## What pull and push do

| Command | Direction | Files | Database |
|---------|-----------|-------|----------|
| `pull staging` | Remote → local | Yes | Yes |
| `pull production` | Remote → local | Yes | Yes |
| `push staging` | Local → remote | Yes | Yes |
| `push production` | Local → remote | Yes | Yes |

Before overwriting a database, WP-dev creates an automatic backup when possible.

## Typical workflow

```bash
npm run wp-dev -- up
npm run wp-dev -- doctor production
npm run wp-dev -- pull production
```

Open `local.url` from config in your browser.

## Dry run (preview only)

```bash
npm run wp-dev -- pull production --dry-run
npm run wp-dev -- push staging --dry-run
npm run wp-dev -- sync-preview pull production
npm run wp-dev -- sync-preview push staging --json
```

## Theme-only deploy (safer for production)

Full `push production` overwrites the remote database. For day-to-day theme work:

```bash
npm run wp-dev -- theme build
npm run wp-dev -- push theme production --build
npm run wp-dev -- pull theme production
```

See [Theme deploy](./theme-deploy.md).

## First pull checklist

1. `npm run setup` and `wp-dev init` with real SSH host, user, path, and `production.url`.
2. `npm run wp-dev -- doctor` (add `--rsync` for pull dry-run).
3. `npm run wp-dev -- up`, open `local.url`.
4. If pull fails with **Permission denied** under `wordpress/`, run `wp-dev up` again (auto-reconciles) or `wp-dev doctor --filesystem`.
5. `npm run wp-dev -- pull production` (or `pull staging`).
6. If warned about **table prefix**, set `WORDPRESS_TABLE_PREFIX` in `docker/.env`, then `down` and `up`.

## URL search-replace

`staging.url` and `production.url` in config must match what the remote database stores for `siteurl` and `home`. Pull rewrites those URLs toward `local.url`.

`wp-config.php` is **not** synced on pull. If the remote uses a custom table prefix, set `WORDPRESS_TABLE_PREFIX` in `docker/.env`.

## Push to empty staging

If no WordPress exists at `staging.path` yet, the first `push staging` may seed files only. Finish the remote installer, then push again for database + search-replace.

## Rollback after a bad sync

| Problem | Fix |
|---------|-----|
| Bad local DB after pull | `wp-dev restore local <pre-pull-backup.sql>` — path printed during pull |
| Bad remote DB after push | `wp-dev restore production <pre-push-backup.sql>` |
| Partial file sync | Fix the error and re-run, or restore from `wp-dev backup` |

Backups live under `~/.wp-dev/backups/<project>/`.

## Sync rules

Control what files are excluded:

```bash
npm run wp-dev -- sync-rules
npm run wp-dev -- sync-scan
```

See [Sync rules](../features/sync-rules.md).

## Failure recovery

See [Sync troubleshooting](../troubleshooting/sync.md) and [Backups](./backups.md).

## Related

- [Environments](./environments.md)
- [SSH setup](../getting-started/ssh.md)
- [Shared hosting](./shared-hosting.md)

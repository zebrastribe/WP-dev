# CLI + sync engine

## Command flow

`cli.ts` → `runWithConfig(label, fn)` → `loadConfig()` + env hydration → `initLogger` → command fn.

## Key services (by concern)

| Service | File | Role |
|---------|------|------|
| SSH | `ssh.ts` | `connectSsh()` — key-only node-ssh session |
| rsync | `rsync.ts` | `rsyncPull` / `rsyncPush` with exclude patterns |
| WP-CLI | `wpcli.ts` | Local (compose) + remote (SSH) DB import/export/search-replace |
| Backup | `backup.ts` | Paths under `~/.wp-dev/backups/<project>/` |
| Sync excludes | `sync-excludes.ts` | Push/pull exclude rule compilation |
| Sync units | `sync-units.ts` | Plugin/theme deployment modes |
| Sync preview | `sync-preview.ts`, `sync-preview-parse.ts` | Dry-run rsync + itemize parsing |
| Sync scan | `sync-scan.ts` | Detect build themes, suggest localOnly |
| Docker | `docker-compose.ts` | `compose()` wrapper, project id |
| Simply | `simply.ts`, `simply-staging.ts` | DNS API helpers |
| Update | `update-preflight.ts` | Git dirty/ahead/behind before `wp-dev update` |

## pull/push safety sequence

1. Pre-backup target DB (local pre-pull, remote pre-push)
2. rsync files (incremental)
3. Export/import DB
4. search-replace URLs (remote↔local variants)
5. On failure: rollback DB from pre-backup when possible

## Config loading

- `wp-dev.config.json` beside clone root (gitignored)
- `ensureWpDevConfigJson` on postinstall copies example
- `hydrateSimplyApiKeyFromComposeEnv` / `hydrateStagingDbFromComposeEnv` merge `docker/.env` secrets

## Non-obvious gotchas

- `pull` does not sync `wp-config.php`; set `WORDPRESS_TABLE_PREFIX` in docker/.env
- `push staging` may bootstrap empty remote (files only, then manual WP install)
- Port stability: `up` syncs localhost URLs; see `purpose/prompt-wp-dev-maintainer-port-stability.md`
- Shared hosting: SSH host often cluster name, not domain; `resolveRemoteWpPath` probes common layouts
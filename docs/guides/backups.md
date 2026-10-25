# Backups and restore

WP-dev keeps backups in `~/.wp-dev/backups/<project>/` — outside the git repo.

## Automatic backups

| Event | Backup |
|-------|--------|
| **pull** (local WP already installed) | Pre-pull SQL dump to `local/` |
| **push** | Pre-push SQL dump on remote |
| **restore** | Pre-restore dump on target before import |

Paths are printed in the CLI output.

## Manual backup

```bash
npm run wp-dev -- backup local
npm run wp-dev -- backup production
npm run wp-dev -- backup staging --files
npm run wp-dev -- backup production --complete
```

| Flag | Effect | Filename |
|------|--------|----------|
| (default) | Database only | `db-*.sql` |
| `--files` | Content: database + `wp-content` | `full-*.tar.gz` |
| `--complete` | Complete install: database + entire WordPress tree (excludes `wp-config.php`) | `complete-*.tar.gz` |

Use **`--complete`** before WordPress, theme, plugin, or PHP updates on Dev, Staging, or Production so you can roll the whole install back if something breaks.

## Restore

```bash
npm run wp-dev -- restore local ~/.wp-dev/backups/my-site/local/pre-pull-2026-06-23.sql
npm run wp-dev -- restore local ~/.wp-dev/backups/my-site/local/complete-….tar.gz
npm run wp-dev -- restore production ~/.wp-dev/backups/<project>/production/db-….sql
npm run wp-dev -- restore staging ~/.wp-dev/backups/<project>/staging/complete-….tar.gz --yes --confirm-host <staging.host>
```

Restore accepts `.sql`, content archives (`full-*.tar.gz`), and complete archives (`complete-*.tar.gz`). Complete restores keep the live `wp-config.php` on the target. Restore **always** creates a pre-restore database backup when possible.

## What backups do not include

- Full server snapshots (use your hoster’s backups too).
- `wp-config.php` in complete archives (live secrets stay on the install).
- `wp-config.php` on pull (excluded from rsync).
- Git history of theme source outside `wordpress/`.

## Browser admin

In `/admin/`:

- **Backup** — env picker, backup type (**Database** | **Content** | **Complete**), Backup now, and restore on the same page for all envs.
- **Advanced → Restore points** — longer restore-point list for the same `~/.wp-dev/backups/<project>/` store.

Both use the terminal runner (`backup` / `restore`). See [Browser admin](./browser-admin.md).

## Related

- [Syncing](./syncing.md)
- [Troubleshooting — sync failures](../troubleshooting/sync.md)

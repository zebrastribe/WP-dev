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
```

| Flag | Effect |
|------|--------|
| (default) | Database only |
| `--files` | Database + `wp-content` tarball |

## Restore

```bash
npm run wp-dev -- restore local ~/.wp-dev/backups/my-site/local/pre-pull-2026-06-23.sql
npm run wp-dev -- restore production /path/to/backup.sql
```

Restore **always** creates a pre-restore backup when possible.

## What backups do not include

- Full server snapshots (use your hoster’s backups too).
- `wp-config.php` on pull (excluded from rsync).
- Git history of theme source outside `wordpress/`.

## Browser admin

The **Backup / Restore** and **History / Rollback** tabs in `/admin/` run the same operations via the terminal runner.

## Related

- [Syncing](./syncing.md)
- [Troubleshooting — sync failures](../troubleshooting/sync.md)

# Filesystem manager

WP-dev’s filesystem manager handles **ownership**, **atomic writes**, and **recovery** for config and WordPress paths.

## Problems it solves

- `chmod 666` / `777` on config files (removed).
- `pull` failing with **Permission denied** under `wordpress/`.
- Plugin updates failing after theme work (`upgrade-temp-backup` not writable).
- Crash-safe writes to `wp-dev.config.json` and `docker/.env`.

## Ownership profiles

| Profile | Examples | Owner |
|---------|----------|-------|
| **Shared config** | `wp-dev.config.json`, `docker/.env` | Your user (664) |
| **Host editable** | `wp-content/themes/` | Your user |
| **Container runtime** | `plugins`, `uploads`, `upgrade`, `upgrade-temp-backup` | www-data (33) |

## Automatic reconciliation

| Event | Action |
|-------|--------|
| `wp-dev up` | Sweep stale temps, reconcile all profiles |
| `wp-dev pull` | Reconcile host paths before rsync; container paths after |
| Update lock | Prevents concurrent `wp-dev update` |

## Diagnostics

```bash
npm run wp-dev -- doctor --filesystem
```

Reports WSL/cloud-sync path warnings, writability, and ownership manifest (`logs/ownership-manifest.json`).

## Manual fallback

```bash
npm run wp-dev -- fix-permissions
npm run wp-dev -- fix-runtime-permissions
```

Usually unnecessary if `up` and `pull` succeed.

## Related

- [Permissions guide](../guides/permissions.md)
- [Permission troubleshooting](../troubleshooting/permissions.md)

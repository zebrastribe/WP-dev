# Permissions and ownership

WordPress in Docker runs as **www-data** (uid 33). Your computer user edits theme files and runs `pull`/`push`. WP-dev reconciles ownership automatically.

## The problem (without WP-dev)

- Docker creates files as www-data.
- `rsync pull` runs as your user → **Permission denied**.
- Fixing with `chmod 777` is insecure and breaks plugin updates.

## What WP-dev does automatically

| When | Action |
|------|--------|
| `wp-dev up` | Filesystem recovery + ownership reconcile |
| `wp-dev pull` | Host-editable paths before rsync; container paths after |
| `wp-dev doctor --filesystem` | Report path warnings and writability |

## Ownership profiles

| Profile | Paths | Owner |
|---------|-------|-------|
| **Shared config** | `wp-dev.config.json`, `docker/.env` | Your user, mode 664 |
| **Host editable** | `wp-content/themes/` | Your user (for IDE editing) |
| **Container runtime** | `plugins`, `uploads`, `upgrade`, `upgrade-temp-backup` | www-data (uid 33) |

## Manual commands (when needed)

```bash
npm run wp-dev -- fix-permissions
npm run wp-dev -- fix-runtime-permissions
npm run wp-dev -- doctor --filesystem
```

Prefer `wp-dev up` or `doctor --filesystem` over manual `chmod`/`chown`.

## Plugin update errors

If wp-admin cannot update plugins (“Could not create directory” under `upgrade`):

```bash
npm run wp-dev -- up
npm run wp-dev -- doctor --filesystem
```

## Related

- [Filesystem manager](../features/filesystem-manager.md)
- [Permission troubleshooting](../troubleshooting/permissions.md)

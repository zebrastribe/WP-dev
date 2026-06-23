# Browser admin and wizard

The setup wizard lives at **`http://localhost:<WP_PORT>/admin/`** — same host and port as WordPress (default **8888**).

## Open the wizard

After `wp-dev up`:

```
http://localhost:8888/admin/
```

On macOS, `wp-dev up` and `status` may print an `open "…/admin/"` command.

## Wizard flow

1. **Start** — project overview.
2. **SSH server** — host, user, path; test SSH from the browser terminal.
3. **Save & sync** — writes `wp-dev.config.json`.
4. **Done** — links to local, staging, and production URLs.

## Security tokens

Set in `docker/.env` (auto-generated on first `up`):

| Variable | Purpose |
|----------|---------|
| `WPDEV_ADMIN_SAVE_TOKEN` | Required for **Save** in the wizard |
| `WPDEV_TERMINAL_AUTH` | Browser terminal login (`user:password`) |
| `WPDEV_TERMINAL_RUNNER_TOKEN` | One-click actions (backup, sync preview, update) |
| `WPDEV_TERMINAL_RUNNER_ORIGIN` | Allowed browser origin for runner |

Copy admin token:

```bash
grep WPDEV_ADMIN_SAVE_TOKEN docker/.env
```

## Tabs

| Tab | Purpose |
|-----|---------|
| **Wizard** | Initial setup |
| **Sync** | Plugin/theme sync rules, preview |
| **Update** | Update WP-dev from git |
| **Terminal** | Embedded shell (also `http://localhost:7681/`) |
| **Services** | Service registry and ports |
| **Backup / Restore** | Database backups |
| **History** | Rollback to previous backups |

## Rebuild after UI changes

If you edit `docs/admin/`:

```bash
npm run admin:build:wp
```

Hot reload during development:

```bash
npm run admin:dev
```

## API

Same-origin: `GET/POST /admin/api.php?action=…`

Developer details: [Admin UI README](../admin/README.md).

## Related

- [First project](../getting-started/first-project.md)
- [Environment variables](../reference/environment-variables.md)

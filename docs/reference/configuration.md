# Configuration reference

Main config file: **`wp-dev.config.json`** at the repo root (gitignored). Copy from **`wp-dev.config.example.json`**.

## Top-level

| Field | Required | Description |
|-------|----------|-------------|
| `project` | Yes | Short unique id for Docker Compose project name |
| `local` | Yes | Local Docker stack settings |
| `staging` | Yes | Remote staging (placeholders OK until used) |
| `production` | Yes | Remote production |
| `sync` | No | Per-plugin/theme sync rules |
| `simply` | No | Simply.com account id for DNS API |

## `local`

| Field | Description |
|-------|-------------|
| `url` | Browser URL for local site (match `WP_PORT`) |
| `path` | Relative path to `docker/` (usually `./docker`) |
| `composeFile` | Compose file name (usually `docker-compose.yml`) |
| `composeService` | WP-CLI service name (usually `wpcli`) |
| `wpRoot` | Relative path to WordPress files (usually `./wordpress`) |
| `composeProjectName` | Optional override for Compose `-p` |
| `themePath` | Optional theme source for `theme build` |
| `themeSlug` | Optional theme slug for deploy |

## `staging` / `production`

| Field | Description |
|-------|-------------|
| `host` | SSH hostname |
| `user` | SSH username |
| `path` | Remote WordPress root (`wp-config.php` directory) |
| `url` | Site URL in remote DB (for search-replace) |
| `identityFile` | Optional path to SSH private key (`~/.ssh/…` recommended) |
| `db` | Optional DB credentials for remote bootstrap |

## `sync`

```json
"sync": {
  "plugins": { "plugin-slug": "localOnly" },
  "themes": {},
  "disabledRecommended": [],
  "skipUploadsOnPush": false
}
```

See [Sync rules](../features/sync-rules.md).

## Example

See `wp-dev.config.example.json` in the repo root.

## Related

- [Environment variables](./environment-variables.md)
- [Environments guide](../guides/environments.md)

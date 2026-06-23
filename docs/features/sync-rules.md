# Sync rules and exclusions

WP-dev excludes certain files from push/pull by default and lets you customize per plugin and theme.

## View effective rules

```bash
npm run wp-dev -- sync-rules
```

## Scan and suggest units

```bash
npm run wp-dev -- sync-scan
npm run wp-dev -- sync-scan --json
```

Used by the **Sync** tab in `/admin/`.

## Config: `sync` section

In `wp-dev.config.json`:

```json
"sync": {
  "plugins": {
    "query-monitor": "localOnly"
  },
  "themes": {},
  "disabledRecommended": [],
  "skipUploadsOnPush": false
}
```

| Value | Meaning |
|-------|---------|
| `localOnly` | Never push this plugin to remote |
| Custom theme rules | Exclude paths like `src/` from push |

## Preview before sync

```bash
npm run wp-dev -- sync-preview push staging
npm run wp-dev -- sync-preview pull production --json
```

## wp-config.php

`wp-config.php` is **not** pulled from remote. Set `WORDPRESS_TABLE_PREFIX` in `docker/.env` if the remote uses a non-`wp_` prefix.

## Related

- [Syncing guide](../guides/syncing.md)
- [Configuration reference](../reference/configuration.md)

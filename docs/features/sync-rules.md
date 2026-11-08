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

In `/admin/`, open **Advanced → Full site rules**. Theme files (the item next to it) copies the theme only and ignores this list.

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

| Choice in the admin | Stored as | Meaning |
|--------------------|-----------|---------|
| Plugin **Include** | `"sync"` (or omitted) | The plugin is copied with a full site sync |
| Plugin **Keep here** | `"localOnly"` | The plugin stays on this computer. The server keeps its own copy |
| Theme **Whole theme** | `{ "mode": "all" }` | The theme folder is copied |
| Theme **Choose folders** | `{ "mode": "custom", "excludeFolders": […] }` | Checked folders and files are copied. Unchecked ones stay here |
| Theme **Skip** | `{ "mode": "localOnly" }` | The theme stays on this computer |

**Leave these out** covers `node_modules`, `debug.log`, the WordPress upgrade folder, and media on push (`skipUploadsOnPush`). A checked box means that item stays off the full site sync.

A host whose name ends in `.invalid` (the Setup template) is not a server. Pull and push refuse it before SSH and do not ask you to pin it in `known_hosts`.

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

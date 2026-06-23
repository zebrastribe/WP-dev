# Theme-only deploy

Use theme commands when you want to deploy **theme files only** — not the full site or database.

## Why

`push production` syncs all of `wordpress/` and overwrites the remote database. That is dangerous for day-to-day theme work.

`push theme production` syncs only your theme folder.

## Commands

```bash
npm run wp-dev -- theme build
npm run wp-dev -- push theme production --build
npm run wp-dev -- push theme production --dry-run
npm run wp-dev -- pull theme production
```

## Config (optional)

In `wp-dev.config.json` → `local`:

```json
"themePath": "./wordpress/wp-content/themes/agency-starter",
"themeSlug": "agency-starter"
```

If omitted, defaults to `<wpRoot>/wp-content/themes/agency-starter`.

## Build themes (_tw style)

Themes with source in the repo root and built assets in `theme/` are supported. `theme build` runs `npm run production` in the theme source tree.

## Full maintainer guide

See [theme-deploy-for-all-users.md](../theme-deploy-for-all-users.md).

## Related

- [Syncing](./syncing.md)
- [Sync rules](../features/sync-rules.md)

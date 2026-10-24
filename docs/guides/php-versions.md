# PHP versions (local, staging, production)

WP-dev can switch PHP for **Dev (local Docker)** and, when the host supports it, **Staging/Production** over SSH. Every successful `php set` stores a **rollback snapshot** under `.wp-dev/php-rollback/`.

## Allowed versions

`7.4`, `8.0`, `8.1`, `8.2`, `8.3`, `8.4`

## Admin UI

**Services** tab → **PHP versions**: show / apply / rollback for Dev, Staging, and Production (same CLI under the hood). Production asks for a confirm dialog in the browser; runners pass `--yes` so the CLI does not double-prompt.

Hosted cloud web UI is not built yet — localhost admin only for now.

## Local (Dev)

Uses `WPDEV_PHP_VERSION` in `docker/.env` and matching `wordpress:php*-apache` / `wordpress:cli-php*` images.

```bash
npm run wp-dev -- php show --env local
npm run wp-dev -- php set 8.3 --env local --restart
# if the site breaks:
npm run wp-dev -- php rollback --env local --restart
```

## Staging / production

1. `php show --env staging` reports the detected strategy (`dot_php_version`, `htaccess_addhandler`, or `unsupported`).
2. If **unsupported**, change PHP in the hosting panel — automated set is refused.
3. If supported:

```bash
npm run wp-dev -- php set 8.2 --env staging
npm run wp-dev -- php rollback --env staging   # restore previous selector files
```

Production prompts for confirmation unless `--yes`.

**Honest limit:** Some hosts ignore `.php-version` until enabled in the panel. If CLI still reports the old version after `set`, run `rollback` and use the panel.

## Related

- [Environment variables](../reference/environment-variables.md)
- [Shared hosting](./shared-hosting.md)

# PHP versions (local, staging, production)

WP-dev can switch PHP for **Dev (local Docker)** and, when the host supports it, **Staging/Production** over SSH. Every successful `php set` stores a **rollback snapshot** under `.wp-dev/php-rollback/`.

## Allowed versions

`7.4`, `8.0`, `8.1`, `8.2`, `8.3`, `8.4`, `8.5`

This list is maintained in WP-dev (not editable in the UI). It tracks [PHP supported versions](https://www.php.net/supported-versions.php) plus older branches still useful for legacy sites, and only versions that have matching official Docker images (`wordpress:phpX.Y-apache` / `wordpress:cli-phpX.Y`). When a new PHP branch ships and Docker Hub publishes those tags, WP-dev adds it in a release — end users do not register versions themselves.

## Admin UI

**WP-dev Local:** Advanced → PHP (under This computer). Detect shows the running version. A version list and Apply appear only when this computer owns the runtime (local Docker). Apply restarts that stack.

**WP-dev Cloud:** Setup, next to the environment you have open. Three outcomes:

1. **Internal lab** — one PHP for every site on that shared lab. Apply recreates the lab WordPress container.
2. **Existing selector** — the host already has a writable `.php-version` or an htaccess `AddHandler`. The change is that environment only. Production asks for the site name.
3. **Anything else** — the detected version, and a note to change PHP in the hosting panel. There is no dropdown.

A writable folder is not treated as permission to invent a selector. Production still asks you to confirm.

## Local (Dev)

Uses `WPDEV_PHP_VERSION` in `docker/.env` and matching `wordpress:php*-apache` / `wordpress:cli-php*` images.

```bash
npm run wp-dev -- php show --env local
npm run wp-dev -- php set 8.3 --env local --restart
# if the site breaks:
npm run wp-dev -- php rollback --env local --restart
```

## Staging / production

1. `php show --env staging` reports current PHP and strategy (`dot_php_version`, `htaccess_addhandler`, or `unsupported`).
2. **unsupported** (typical on shared hosts with no selector files yet): change PHP in the hosting panel — automated set is refused. Writable web root alone is not enough.
3. If supported (selector already present and writable):

```bash
npm run wp-dev -- php set 8.2 --env staging
npm run wp-dev -- php rollback --env staging   # restore previous selector files
```

Production prompts for confirmation unless `--yes`.

**Honest limit:** Some hosts ignore `.php-version` until enabled in the panel. If CLI still reports the old version after `set`, run `rollback` and use the panel.

## Related

- [Environment variables](../reference/environment-variables.md)
- [Shared hosting](./shared-hosting.md)

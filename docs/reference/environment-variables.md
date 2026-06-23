# Environment variables

File: **`docker/.env`** (gitignored). Copy from **`docker/.env.example`**.

WP-dev auto-generates security tokens on first `wp-dev up`.

## Database

| Variable | Default | Description |
|----------|---------|-------------|
| `MYSQL_DATABASE` | wordpress | Database name |
| `MYSQL_USER` | wordpress | Database user |
| `MYSQL_PASSWORD` | wordpress | Database password |
| `MYSQL_ROOT_PASSWORD` | root | Root password |
| `WORDPRESS_TABLE_PREFIX` | wp_ | Must match imported DB prefix |

## Ports

| Variable | Default | Description |
|----------|---------|-------------|
| `WP_PORT` | 8888 | WordPress HTTP |
| `WP_HTTPS_PORT` | 8443 | Local HTTPS |
| `WPDEV_TERMINAL_PORT` | 7681 | Browser terminal |
| `WPDEV_TERMINAL_RUNNER_PORT` | 7682 | Terminal runner |
| `WPDEV_HOST_RUNNER_PORT` | 7683 | Sync runner |

## PHP version

| Variable | Default | Description |
|----------|---------|-------------|
| `WPDEV_PHP_VERSION` | 8.2 | Docker image tag (`7.4`–`8.4`) |

Change with `wp-dev php set <version>`, then `down` and `up`.

## HTTPS

| Variable | Default | Description |
|----------|---------|-------------|
| `WPDEV_LOCAL_HTTPS` | 0 | Set `1` when SSL enabled |
| | | Use `wp-dev ssl enable` |

## Browser admin and terminal

| Variable | Description |
|----------|-------------|
| `WPDEV_ADMIN_SAVE_TOKEN` | **Required** for wizard Save |
| `WPDEV_TERMINAL_AUTH` | Terminal login `user:password` |
| `WPDEV_TERMINAL_RUNNER_TOKEN` | Runner API secret |
| `WPDEV_TERMINAL_RUNNER_ORIGIN` | Allowed origin (e.g. `http://localhost:8888`) |
| `WPDEV_TERMINAL_WORKDIR` | Default cwd in terminal (`/workspace`) |

## Optional

| Variable | Description |
|----------|-------------|
| `WPDEV_SIMPLY_API_KEY` | Simply.com API key for DNS helpers |
| `WPDEV_IMPORT_TOKEN` | Content Recovery Workspace API |

## Related

- [Ports guide](../guides/ports.md)
- [Browser admin](../guides/browser-admin.md)
- [Configuration](./configuration.md)

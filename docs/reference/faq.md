# FAQ

## What is WP-dev?

A command-line tool that runs WordPress locally in Docker and syncs files and database with staging and production servers over SSH.

WP-dev does **not** host your staging or production sites.

## Do I need Docker?

Yes. WP-dev uses Docker Compose for MySQL, WordPress, and helper services.

## Can I use LocalWP instead?

WP-dev is its own stack. It does not integrate with LocalWP. You can migrate by pulling your remote site into WP-dev’s `wordpress/` folder.

## What platforms are supported?

macOS and Linux. Windows: use WSL2 with Linux inside.

## How do I install?

```bash
git clone https://github.com/zebrastribe/WP-dev.git
cd WP-dev
npm run setup
npm run wp-dev -- up
```

See [Installation](../getting-started/installation.md).

## How do I update WP-dev?

```bash
npm run wp-dev -- update
```

Your site in `wordpress/` is not replaced. See [Update guide](../getting-started/update.md).

## How do I connect SSH?

Create a key, upload the `.pub` file to your host, add host/user/path to config. See [SSH setup](../getting-started/ssh.md).

## How do I sync my live site?

```bash
npm run wp-dev -- init
npm run wp-dev -- pull production
```

See [Syncing](../guides/syncing.md).

## How do I push changes?

```bash
npm run wp-dev -- push staging
```

Use `push theme production` for theme-only deploys. Full `push production` overwrites the remote database.

## How do I restore a backup?

```bash
npm run wp-dev -- restore local /path/to/backup.sql
```

See [Backups](../guides/backups.md).

## Where is my project stored?

- **Tool:** the git clone (for example `~/Projects/WP-dev`).
- **WordPress files:** `wordpress/` in that clone.
- **Backups:** `~/.wp-dev/backups/<project>/`.
- **Config:** `wp-dev.config.json` and `docker/.env` in the clone (gitignored).

## How do I remove a project?

1. `npm run wp-dev -- down`
2. Delete the clone folder (or keep it and remove `wordpress/` if you only want to reset the site).
3. Optional: remove `~/.wp-dev/backups/<project>/`.

## What is the browser wizard?

`http://localhost:8888/admin/` — setup UI built into WordPress. See [Browser admin](../guides/browser-admin.md).

## Port 8888 is busy — what now?

Change `WP_PORT` in `docker/.env` and `local.url` in config, or run `wp-dev up --relocate-ports`.

## Who creates my SSH keys?

You do. WP-dev never creates keys for you.

## Where is the full command list?

[Command reference](./commands.md)

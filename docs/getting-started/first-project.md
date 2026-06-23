# Your first project

Goal: WordPress running locally in under five minutes.

## 1. Start the stack

From the repo root (the folder with `package.json`):

```bash
npm run wp-dev -- up
```

On first run, WP-dev creates `docker/.env` from the example file and fills in security tokens automatically.

## 2. Open the setup wizard

Open in your browser (default port **8888**):

```
http://localhost:8888/admin/
```

The wizard walks you through:

1. **Project name** — a short id for this site (for example `my-agency-site`).
2. **Local URL** — usually `http://localhost:8888`.
3. **SSH / server** — skip for now if you only want a blank local site.
4. **Save** — writes `wp-dev.config.json`.

> **Tip:** If **Save** asks for a token, copy `WPDEV_ADMIN_SAVE_TOKEN` from `docker/.env`:
> ```bash
> grep WPDEV_ADMIN_SAVE_TOKEN docker/.env
> ```

## 3. Open WordPress

Visit the URL in `wp-dev.config.json` → `local.url` (for example `http://localhost:8888`).

- **New empty database:** complete the WordPress installer in the browser.
- **Existing site:** configure SSH in the wizard or run `wp-dev init`, then see [Syncing](../guides/syncing.md).

## 4. Check status

```bash
npm run wp-dev -- status
```

Shows Docker health, whether WordPress is installed, and recent backups.

## Terminal alternative to the wizard

```bash
npm run wp-dev -- init
```

Interactive prompts write `wp-dev.config.json` without the browser.

## Two common paths

### A — Local site only (no server yet)

1. Complete steps 1–3 above.
2. Develop locally.
3. When you have a server, set up [SSH](./ssh.md) and use [Syncing](../guides/syncing.md).

### B — Copy an existing site from staging or production

1. Complete steps 1–2.
2. [Set up SSH](./ssh.md) and add your public key on the server.
3. `npm run wp-dev -- init` — real SSH host, user, remote path, and production URL.
4. `npm run wp-dev -- doctor production` — verify connection.
5. `npm run wp-dev -- pull production` — downloads files and database.

See the [first pull checklist](../guides/syncing.md#first-pull-checklist) for shared hosting tips.

## Where files live

| Path | What it is |
|------|------------|
| `wp-dev.config.json` | Project settings (gitignored) |
| `docker/.env` | Ports and secrets (gitignored) |
| `wordpress/` | Your local WordPress files |
| `logs/` | WP-dev log files |

Always run `wp-dev` commands from the **repo root**.

## Next steps

- [SSH setup](./ssh.md)
- [Syncing guide](../guides/syncing.md)
- [Browser admin](../guides/browser-admin.md)
- [FAQ](../reference/faq.md)

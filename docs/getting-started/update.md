# Update WP-dev

Updating WP-dev updates the **tool**, not your WordPress site. Themes, plugins, uploads, and your local database stay in `wordpress/`.

## Recommended — one command

```bash
npm run wp-dev -- update
```

This pulls the latest git changes, rebuilds the CLI and admin UI, and restarts the local stack.

## From the browser

Open `/admin/` → **Update** tab (after `wp-dev up`).

## Options

```bash
npm run wp-dev -- update --dry-run      # show steps only
npm run wp-dev -- update --preflight     # git status check
npm run wp-dev -- update --no-restart   # skip down/up
npm run wp-dev -- update --no-admin     # skip admin rebuild
npm run wp-dev -- update --skip-pull    # rebuild only (you already pulled git)
```

## Manual equivalent

```bash
git pull --rebase --autostash
npm install
npm run build
npm run admin:build:wp
npm run wp-dev -- down
npm run wp-dev -- up
```

Or:

```bash
npm run setup
npm run wp-dev -- up
```

## What is preserved

Gitignored and safe across updates:

- `wp-dev.config.json`
- `docker/.env`
- `wordpress/` (your site)
- `logs/`

`wordpress/admin/` is **rebuilt** when admin build runs (the WP-dev wizard UI).

## Forks and local commits

If you have local git commits on top of upstream WP-dev, `update` alone may not merge your work:

```bash
git checkout -b save-my-work
git add … && git commit -m "snapshot"
git checkout main
git pull --rebase origin main
npm run wp-dev -- update --skip-pull
git merge save-my-work
```

**Do not run `git clean -fd` during a merge** — it removes secrets like `docker/.env`.

## After updating

If you changed Docker files (terminal image, compose):

```bash
npm run wp-dev -- down
npm run wp-dev -- up
```

Rebuild admin if you develop the wizard UI:

```bash
npm run admin:build:wp
```

## See also

- [Release and CI](../developer/release.md)
- [FAQ — How do I update?](../reference/faq.md)

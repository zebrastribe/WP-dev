# Common Commands

## macOS first run

```bash
git clone https://github.com/zebrastribe/WP-dev.git
cd WP-dev
npm run quickstart
# wizard opens at http://localhost:8888/admin/ — choose "Sync from my server (SSH only)"
```

SSH key (one-time on Mac):

```bash
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519
ssh-add --apple-use-keychain ~/.ssh/id_ed25519
# upload ~/.ssh/id_ed25519.pub to your host
```

## Update wp-dev (after git pull)

Safe update — **does not overwrite your `wordpress/` site** (themes, plugins, uploads, DB):

```bash
npm run wp-dev -- update
```

Or from `/admin/` → **Update** tab.

Preview steps only:

```bash
npm run wp-dev -- update --dry-run
```

Manual equivalent:

```bash
git pull --rebase --autostash &&
npm run build &&
npm run wp-dev -- up
```

Verify:

```bash
npm run wp-dev -- up          # run twice — port should not keep incrementing
npm run wp-dev -- doctor --local-http
```

## Full refresh

```bash
git pull --rebase --autostash &&
npm run build &&
npm run admin:build:wp &&
npm run build --prefix docs/admin &&
npm run wp-dev -- down &&
npm run wp-dev -- up
```

## Staging doctor

```bash
npm run wp-dev -- doctor staging --http
```

## Production pull flow

```bash
git pull --rebase --autostash &&
npm run build &&
npm run wp-dev -- doctor production &&
npm run wp-dev -- pull production
```

## Path-specific workflow (edit path)

```bash
cd /path/to/your/WP-dev
npm install &&
npm run build &&
npm run wp-dev -- pull production
```

## Commit + push
```bash
git status &&
git commit -am "your message" &&
git push
```

## Commit + push (safer)
```bash
git status &&
git diff &&
git add <file1> <file2> &&
git commit -m "your message mm" &&
git push
```
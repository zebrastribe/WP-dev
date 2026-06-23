# Command reference

Run commands from the **repo root** (folder with `wp-dev.config.json`):

```bash
npm run wp-dev -- <command>
```

Verify against your install: `npm run wp-dev -- --help`

## Daily commands

| Command | Description |
|---------|-------------|
| `up` | Start local WordPress (Docker) |
| `down` | Stop local stack |
| `status` | Stack health, WP install state, backups |
| `pull <env>` | Sync remote → local (`staging` or `production`) |
| `push <env>` | Sync local → remote |
| `doctor [env]` | Check SSH, WordPress, optional rsync/HTTP |
| `update` | Update WP-dev from git (keeps your site) |
| `init` | Interactive config wizard in terminal |
| `logs` | Show recent `logs/wp-dev.log` lines |

`<env>` is `staging` or `production` unless noted.

## Stack lifecycle

```bash
npm run wp-dev -- up
npm run wp-dev -- up --relocate-ports
npm run wp-dev -- up --reclaim-ports
npm run wp-dev -- down
npm run wp-dev -- down --remove-orphans
```

## Sync

```bash
npm run wp-dev -- pull production
npm run wp-dev -- pull staging --dry-run
npm run wp-dev -- push staging
npm run wp-dev -- sync-preview pull production
npm run wp-dev -- sync-rules
npm run wp-dev -- sync-scan
```

## Theme-only

```bash
npm run wp-dev -- theme build
npm run wp-dev -- push theme production --build
npm run wp-dev -- pull theme production
```

## Backups

```bash
npm run wp-dev -- backup local
npm run wp-dev -- backup production --files
npm run wp-dev -- restore local ~/.wp-dev/backups/.../file.sql
```

## Diagnostics

```bash
npm run wp-dev -- doctor
npm run wp-dev -- doctor production --rsync
npm run wp-dev -- doctor --filesystem
npm run wp-dev -- doctor --lifecycle
npm run wp-dev -- doctor --local-http
npm run wp-dev -- validate
npm run wp-dev -- validate --remote production
```

## Service manager

```bash
npm run wp-dev -- services
npm run wp-dev -- supervisor status
```

## Permissions

```bash
npm run wp-dev -- fix-permissions
npm run wp-dev -- fix-runtime-permissions
```

## Config and setup

```bash
npm run wp-dev -- init
npm run wp-dev -- quickstart
```

## SSL and PHP (optional)

```bash
npm run wp-dev -- ssl enable
npm run wp-dev -- ssl disable
npm run wp-dev -- php show
npm run wp-dev -- php set 8.3
```

## Simply.com API (optional)

```bash
npm run wp-dev -- simply test
npm run wp-dev -- simply setup-staging-dns example.com
```

## Update WP-dev

```bash
npm run wp-dev -- update
npm run wp-dev -- update --dry-run
npm run wp-dev -- update --preflight
```

## npm scripts (repo root)

| Script | Description |
|--------|-------------|
| `npm run setup` | Prereqs + install + build |
| `npm run quickstart` | setup + quickstart (macOS-friendly) |
| `npm run check` | Docker, Compose, ssh, rsync |
| `npm run build` | Build CLI |
| `npm run admin:build:wp` | Build admin into `wordpress/admin/` |
| `npm test` | Unit tests |
| `npm run release:gate` | Full validation (CI mirror) |

## Import workspace

```bash
npm run wp-dev -- import build
npm run wp-dev -- import ingest
npm run wp-dev -- import push
```

## Help per command

```bash
npm run wp-dev -- pull --help
npm run wp-dev -- doctor --help
```

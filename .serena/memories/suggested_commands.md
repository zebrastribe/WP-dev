# Commands (run from repo root unless noted)

## Setup / dev

```bash
npm run check              # docker, compose, ssh, rsync prereqs
npm run setup              # install + build CLI + admin
npm run quickstart         # setup + wp-dev quickstart (Mac first-run)
npm run dev                # CLI via tsx (src/cli.ts)
npm run admin:dev          # Vite HMR for admin UI
```

## Build

```bash
npm run build              # generate config artifacts + tsc → dist/
npm run admin:build:wp     # admin → wordpress/admin/
npm run generate:config-artifacts  # schema JSON from Zod
```

## Local stack

```bash
npm run wp-dev -- up
npm run wp-dev -- down
npm run wp-dev -- status
npm run wp-dev -- doctor --local-http
npm run wp-dev -- validate
npm run wp-dev -- logs
```

## Sync (needs configured remotes in wp-dev.config.json)

```bash
npm run wp-dev -- pull production
npm run wp-dev -- push staging
npm run wp-dev -- sync-preview push staging
npm run wp-dev -- sync-rules
npm run wp-dev -- fix-permissions
```

## Update tool (preserves wordpress/ site)

```bash
npm run wp-dev -- update
npm run wp-dev -- update --dry-run
```

## Tests

```bash
npm test                   # unit + integration
npm run test:coverage
npm run test:smoke           # requires npm run build first
npm run test:all
```

## Admin subproject

```bash
npm ci --prefix docs/admin
npm run typecheck --prefix docs/admin
npm run build:wp --prefix docs/admin
```

## Serena maintenance

```bash
serena memories check      # from repo root
```
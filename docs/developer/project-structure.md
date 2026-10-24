# Project structure

```
WP-dev/
├── src/                    # CLI source (TypeScript)
│   ├── cli.ts              # Entry point
│   ├── commands/           # Command implementations
│   ├── config/             # Schema and config load
│   ├── fs/                 # Filesystem manager
│   ├── supervisor/         # Service manager
│   ├── services/           # rsync, ssh, wpcli, sync
│   └── utils/              # Shared helpers
├── dist/                   # Compiled CLI (npm run build)
├── docker/                 # Compose stack
│   ├── docker-compose.yml
│   ├── .env.example
│   └── terminal.Dockerfile
├── docs/                   # User and developer documentation
├── docs/admin/             # Browser admin (React + Vite)
├── wordpress/              # Local WP files (gitignored content)
│   └── admin/              # Built wizard UI
├── tests/                  # Vitest unit/integration tests
├── scripts/                # Build, prereqs, release gate
├── wp-dev.config.json      # Project config (gitignored)
└── package.json
```

## Run commands from

The folder containing `package.json` and `wp-dev.config.json`.

## Public vs private (hosted web)

This repo (**WP-dev**) stays **public**: localhost CLI, Docker, local admin, and (later) shared `packages/sync-engine` + `packages/wpdev-web`.

A separate **private** repo ([zebrastribe/WP-dev-cloud](https://github.com/zebrastribe/WP-dev-cloud)) holds hosted/control-plane planning (and later code). It is **not** required for everyday CLI use. See the public stub [online-migration-plan.md](./online-migration-plan.md).

## Optional: content recovery / import workspace

`content-recovery-workspace/` and `wp-dev import *` are **site-specific** Wayback→WordPress import tooling. They are not part of the core Dev→Staging→Production sync product. Runtime SQLite under `content-recovery-workspace/storage/` is gitignored.

## Gitignored (typical)

- `wp-dev.config.json`
- `docker/.env`
- `wordpress/*` (site content)
- `logs/*.log`
- `local-commands.md` (private snippets; use `local-commands.example.md` as template)
- `content-recovery-workspace/storage/**/*.sqlite`

## Related

- [Architecture](./architecture.md)
- [Testing](./testing.md)

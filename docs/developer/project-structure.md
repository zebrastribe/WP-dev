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

## Gitignored (typical)

- `wp-dev.config.json`
- `docker/.env`
- `wordpress/*` (site content)
- `logs/*.log`
- `local-commands.md` (private snippets; use `local-commands.example.md` as template)

## Related

- [Architecture](./architecture.md)
- [Testing](./testing.md)

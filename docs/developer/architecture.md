# Architecture overview

WP-dev is a Node.js CLI that orchestrates Docker Compose, SSH/rsync, and WP-CLI for local WordPress development.

## High-level flow

```
Developer
    │
    ▼
wp-dev CLI (src/cli.ts)
    │
    ├── Service manager (src/supervisor/) — ports, registry, lifecycle
    ├── Filesystem manager (src/fs/) — ownership, atomic writes
    ├── Docker Compose (docker/) — MySQL, WordPress, terminal
    ├── SSH + rsync (src/services/) — remote sync
    └── Browser admin (docs/admin/) — wizard, sync UI
```

## Major modules

| Module | Path | Role |
|--------|------|------|
| CLI | `src/cli.ts` | Commander.js entry, command routing |
| Config | `src/config/` | Zod schema, `wp-dev.config.json` load/save |
| Commands | `src/commands/` | `up`, `pull`, `push`, `doctor`, … |
| Supervisor | `src/supervisor/` | Startup/shutdown state machines, port manager |
| Filesystem | `src/fs/` | Ownership profiles, atomic writes, recovery |
| Services | `src/services/` | rsync, ssh, wpcli, backup, sync engine |
| Docker | `docker/` | Compose stack, terminal image, runners |
| Admin | `docs/admin/` | React wizard → `wordpress/admin/` |

## Data flow: pull

1. Validate config and SSH.
2. Reconcile host filesystem permissions.
3. Export remote DB via WP-CLI over SSH.
4. rsync remote files → `wordpress/` (excludes `wp-config.php`).
5. Import DB locally, search-replace URLs toward `local.url`.
6. Reconcile container runtime permissions.

## Isolation between clones

Each clone uses `project` in config as the Docker Compose project name (`-p`). Ports come from `docker/.env` per clone.

## Design notes

Internal RFCs and historical notes live in `purpose/` (not end-user docs).

## Related

- [Project structure](./project-structure.md)
- [Service manager](../features/service-manager.md)
- [Filesystem manager](../features/filesystem-manager.md)

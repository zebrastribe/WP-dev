# Troubleshooting

Quick index. Each topic has symptoms, cause, fix, and verification.

| Problem | Page |
|---------|------|
| SSH / connection | [SSH](./ssh.md) |
| Permissions / plugin updates | [Permissions](./permissions.md) |
| Port conflicts / wrong URLs | [Ports](./ports.md) |
| Pull / push failures | [Sync](./sync.md) |

## Quick fixes

| Symptom | Try |
|---------|-----|
| Docker not running | Open Docker Desktop (Mac) or start Docker service (Linux), then `wp-dev up` |
| `Permission denied` on `dist/cli.js` | `npm run build` |
| No `wp-dev.config.json` | `npm install` or copy `wp-dev.config.example.json` |
| Save fails in wizard | Copy `WPDEV_ADMIN_SAVE_TOKEN` from `docker/.env` |
| Port 8888 in use | `wp-dev up --relocate-ports` or change `WP_PORT` in `docker/.env` |
| `mkstemp` on pull | `wp-dev up` or `wp-dev doctor --filesystem` |
| Plugin update folder errors | `wp-dev up` then `doctor --filesystem` |
| Wrong links after pull | Check `local.url`; run `doctor --local-http` |
| Stack won’t start | `wp-dev services` · `wp-dev doctor --lifecycle` |

## Get logs

```bash
npm run wp-dev -- logs
tail -f logs/wp-dev.log
```

Admin API log: `logs/wp-dev-admin-api.log`

## Run diagnostics

```bash
npm run wp-dev -- status
npm run wp-dev -- doctor
npm run wp-dev -- doctor --filesystem
npm run wp-dev -- doctor --lifecycle
npm run wp-dev -- validate
```

## Still stuck?

- [FAQ](../reference/faq.md)
- [GitHub Issues](https://github.com/zebrastribe/WP-dev/issues)

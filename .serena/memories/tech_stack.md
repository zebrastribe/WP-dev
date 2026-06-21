# Tech stack

## CLI (repo root)

- **Runtime:** Node.js ≥20, ESM (`"type": "module"`)
- **Language:** TypeScript 5.7, strict, `NodeNext` modules → `dist/`
- **CLI:** commander ^12
- **SSH:** node-ssh ^13 (ssh2 wrapper, key-only)
- **Shell:** execa ^9
- **Validation:** zod ^3.24; JSON Schema artifacts via zod-to-json-schema + ajv
- **Tests:** vitest ^3, v8 coverage, fork pool

## Admin UI (`docs/admin/`)

- React 19, Vite 6, Tailwind 3, TypeScript 5.7
- Build: `vite build:wp` → `wordpress/admin/` (served by Apache in Docker)
- PHP 8+ for `api.php`, `schema-validate.inc.php`

## Infrastructure

- Docker Compose v2: `wordpress:php*-apache`, `mysql:8`, `wordpress:cli-php*`
- System deps: docker, ssh, rsync (checked by `npm run check`)
- Optional: mkcert (local HTTPS), Simply.com API (`WPDEV_SIMPLY_API_KEY`)

## Gitignored runtime

`wp-dev.config.json`, `docker/.env`, `wordpress/*`, `logs/*`, `local-commands.md`
# Plugin update: `upgrade-temp-backup` permissions

**Date:** 2026-06-21  
**Symptom (wp-admin, Danish):**

```
Plugin-opdatering mislykkedes.
En fejl opstod under opdateringen af Maintenance: Kunne ikke flytte den gamle version til upgrade-temp-backup-mappen.
```

**English:** *Could not move the old version to the upgrade-temp-backup folder.*

## Cause

WordPress 6.3+ backs up plugins/themes during updates under `wp-content/upgrade-temp-backup/`. In wp-dev, `fix-permissions` chowns the bind-mounted `wordpress/` tree to the host user so rsync and theme editing work. Runtime paths are then re-owned as **www-data** — but `upgrade-temp-backup` was missing from that list, so it stayed host-owned and wp-admin updates failed at the “move old version” step.

## Fix (local)

```bash
npm run build
npm run wp-dev -- fix-runtime-permissions
npm run wp-dev -- doctor
```

Retry the plugin update in wp-admin. If a partial unpack remains, remove `wordpress/wp-content/upgrade/<plugin>.<version>/` first (may need Docker root: `docker compose run --rm --user 0 --entrypoint sh wordpress -lc 'rm -rf /var/www/html/wp-content/upgrade/...'`).

## Code change

- `wp-content/upgrade-temp-backup` added to `RUNTIME_WRITE_PATHS` in `src/commands/fix-permissions.ts`
- `doctor` checks write access to both `upgrade` and `upgrade-temp-backup`
- README troubleshooting row for the Danish/English error message

## Verification (timework local)

```bash
npm run wp-dev -- fix-runtime-permissions
npm run wp-dev -- doctor   # upgrade + upgrade-temp-backup write OK
wp plugin update maintenance   # via wpcli container — 4.21 → 4.30 OK
```

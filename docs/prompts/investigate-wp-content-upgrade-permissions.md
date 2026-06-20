# Prompt: Investigate recurring `wp-content/upgrade` permission failures in wp-dev

Copy everything below the line into a Cursor agent working in the **WP-dev** repository.

---

## Task

Investigate and permanently fix recurring WordPress plugin update failures in the wp-dev Docker local stack:

```
En fejl opstod under opdateringen af <plugin>: Kunne ikke oprette mappe.
/var/www/html/wp-content/upgrade/<plugin>.<version>
```

This error returns after users run theme development workflows or `wp-dev fix-permissions`.

## Context

- Local WordPress is bind-mounted: `WP-dev/wordpress/` → `/var/www/html` in the `wordpress` Apache container (runs as **www-data**, uid **33**).
- Host developers edit themes under `wp-content/themes/` as their Linux user.
- `wp-dev fix-permissions` was added so **rsync pull** can write the bind mount after Docker created files as www-data.
- `cmdFixRuntimeWritePermissions` exists in `src/commands/fix-permissions.ts` and runs after `wp-dev up` and `wp-dev pull`, but **not** after manual `fix-permissions` — which leaves `wp-content/upgrade` and `plugins/` owned by the host user and breaks wp-admin updates.

## What to verify

1. Reproduce: `wp-dev fix-permissions` → confirm `wp-content/upgrade` is host-owned → attempt plugin update in wp-admin → expect failure.
2. Confirm fix: `wp-dev fix-runtime-permissions` → plugin update succeeds.
3. Review `src/commands/fix-permissions.ts`, `src/commands/up.ts`, `src/commands/pull.ts`, `src/commands/doctor.ts`, `docker/docker-compose.yml`, and README troubleshooting.
4. Ensure the long-term design satisfies **both**:
   - Host can edit `wp-content/themes/` (npm, IDE, git)
   - www-data can write `wp-content/upgrade`, `plugins`, `uploads`, `cache`, `languages`

## Expected deliverables

1. **Code fix** so `fix-permissions` does not leave runtime paths broken (restore www-data on runtime paths automatically, or scope host chown narrowly).
2. **Explicit CLI**: `wp-dev fix-runtime-permissions` for manual recovery.
3. **`wp-dev doctor`** local check: www-data can write `wp-content/upgrade`.
4. **README** troubleshooting row for this error (Danish + English messages).
5. **Tests** if practical (unit test for `RUNTIME_WRITE_PATHS` / shell builder; optional integration note).
6. Do not break `pull` (rsync before import) or host theme editing workflows.

## Acceptance criteria

- After `wp-dev fix-permissions`, `wp-dev doctor` passes the local runtime write check.
- Plugin updates from wp-admin work without manual intervention.
- `wp-content/themes/agency-starter` remains editable by the host user after `fix-permissions`.
- `wp-dev up` still applies runtime permissions on start.

## Commands

```bash
cd WP-dev
npm run build
npm run wp-dev -- fix-runtime-permissions
npm run wp-dev -- doctor
ls -la wordpress/wp-content/upgrade wordpress/wp-content/plugins
```

## Notes

- Apache user in official `wordpress:*-apache` image is www-data (33:33).
- `wpcli` service uses `user: "33:33"` — align runtime ownership with that.
- Avoid requiring `sudo` on the host; fixes must run via `docker compose run`.

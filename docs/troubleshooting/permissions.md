# Permission troubleshooting

## mkstemp / rsync permission denied on pull

**Symptoms:** `pull` fails writing under `wordpress/` (often `uploads/` or `plugins/`); rsync exit 23.

**Cause:** Runtime paths owned by www-data while host-side rsync runs as your user. Pull should chown the tree to the host user **before** rsync, then restore www-data on runtime paths after.

**Fix:**

```bash
npm run wp-dev -- up
npm run wp-dev -- doctor --filesystem
npm run wp-dev -- fix-permissions
```

**Verify:** `npm run wp-dev -- pull production --yes --dry-run` succeeds (then a real pull without `--dry-run`).

---

## Plugin update: Could not create directory (upgrade)

**Symptoms:** wp-admin plugin update fails under `wp-content/upgrade` or `upgrade-temp-backup`.

**Cause:** Runtime paths not owned by www-data after manual `chown` or theme work.

**Fix:**

```bash
npm run wp-dev -- fix-runtime-permissions
npm run wp-dev -- doctor
```

---

## All-in-One WP Migration: cannot create ai1wm-backups stubs

**Symptoms:** AI1WM admin errors like “Could not create …/wp-content/ai1wm-backups/.htaccess” (also `web.config`, `index.php`, `robots.txt`).

**Cause:** `ai1wm-backups` stayed host-owned after `fix-permissions` / pull (missing from runtime www-data paths).

**Fix:**

```bash
npm run wp-dev -- fix-runtime-permissions
```

**Verify:** `npm run wp-dev -- doctor` reports Local runtime write OK including `ai1wm-backups`. Retry AI1WM in wp-admin.

---

## wp-admin asks for FTP (theme/plugin update)

**Symptoms:** “Connection Information” / FTP hostname form when updating themes or plugins (even with `FS_METHOD` direct).

**Cause:** www-data cannot write themes or site roots (host-owned without group write).

**Fix:**

```bash
npm run wp-dev -- fix-runtime-permissions
```

---

## Core update: some files could not be copied (update-core.php)

**Symptoms:** WordPress core update downloads and unpacks, then fails copying files (often names `wp-admin/includes/update-core.php`). Danish: *“nogle filer ikke kunne kopieres… fil-tilladelserne”*.

**Cause:** `wp-admin` / `wp-includes` stayed host:host after pull — Apache is not in that group, so `FS_METHOD=direct` cannot overwrite core files.

**Fix (WordPress bind-mount standard — host owner, www-data group write):**

```bash
npm run wp-dev -- fix-runtime-permissions
npm run wp-dev -- doctor
```

Then retry Dashboard → Updates. Do not use FTP credentials on local Docker.

---

## docker/.env not writable

**Symptoms:** `up` fails writing ports or tokens.

**Fix:**

```bash
npm run wp-dev -- up
npm run wp-dev -- doctor --filesystem
```

---

## Related

- [Permissions guide](../guides/permissions.md)
- [Filesystem manager](../features/filesystem-manager.md)

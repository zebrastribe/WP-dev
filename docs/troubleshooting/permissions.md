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
npm run wp-dev -- up
npm run wp-dev -- doctor --filesystem
```

**Verify:** Update a plugin in wp-admin.

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

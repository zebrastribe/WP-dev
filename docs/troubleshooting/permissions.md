# Permission troubleshooting

## mkstemp Permission denied on pull

**Symptoms:** `pull` fails writing under `wordpress/`.

**Cause:** Docker owns files as www-data; rsync runs as your user.

**Fix:**

```bash
npm run wp-dev -- up
npm run wp-dev -- doctor --filesystem
```

**Verify:** `pull production --dry-run` succeeds.

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
